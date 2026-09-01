import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { dashboardRoutes } from './dashboard.js';
import { prisma } from '../lib/prisma.js';
import { makeSale } from '../tests/factories/sale-factory.js';
import { makeProduct } from '../tests/factories/product-factory.js';
import { makeGlobalSettings } from '../tests/factories/settings-factory.js';
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    sale: {
      findMany: vi.fn(),
    },
    globalSettings: {
      findUnique: vi.fn(),
    },
  },
}));

async function buildTestApp() {
  const app = Fastify();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyJwt, { secret: 'test-super-secret' });

  app.decorate('authenticate', async (request: FastifyRequest, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ message: 'Unauthorized' });
    }
  });

  await app.register(dashboardRoutes);

  return app;
}

describe('Dashboard Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
    token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
  });

  describe('GET /stats', () => {
    describe('Authentication & Validation', () => {
      it('should return 401 Unauthorized if no authorization header is provided', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/stats',
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Unauthorized' });
      });

      it('should return 401 Unauthorized if invalid token is provided', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          headers: {
            Authorization: 'Bearer invalid-token',
          },
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Unauthorized' });
      });

      it('should return 400 Bad Request if days query parameter is negative or invalid', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          query: { days: '-10' },
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('Stats Calculation', () => {
      it('should return empty stats when there are no sales', async () => {
        vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
        vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);

        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          grossRevenue: 0,
          grossRevenueDelta: 0,
          netRevenue: 0,
          grossProfit: 0,
          netProfit: 0,
          netProfitDelta: 0,
          totalOrders: 0,
          totalOrdersDelta: 0,
          monthlyStats: [],
          marginBreakdown: {
            netProfit: 0,
            costs: 0,
            deliveryTax: 0,
          },
          topSelling: [],
        });
      });

      it('should calculate stats without days filter correctly', async () => {
        const product1 = makeProduct({ id: 'prod-1', name: 'Product A', acquisitionCost: 50, shippingCost: 10, directCosts: 5, taxRate: 0.1 });
        const product2 = makeProduct({ id: 'prod-2', name: 'Product B', acquisitionCost: 30, shippingCost: 5, directCosts: 2, taxRate: 0.05 });

        const sale1 = {
          ...makeSale({
            id: 'sale-1',
            productId: 'prod-1',
            quantity: 2,
            finalPrice: 100,
            calculatedProfit: 40,
            status: 'COMPLETED',
            createdAt: new Date('2026-01-15T10:00:00.000Z'),
          }),
          product: product1,
        };

        const sale2 = {
          ...makeSale({
            id: 'sale-2',
            productId: 'prod-2',
            quantity: 1,
            finalPrice: 50,
            calculatedProfit: 15,
            status: 'COMPLETED',
            createdAt: new Date('2026-01-20T12:00:00.000Z'),
          }),
          product: product2,
        };

        const sale3 = {
          ...makeSale({
            id: 'sale-3',
            productId: 'prod-1',
            quantity: 1,
            finalPrice: 100,
            calculatedProfit: 20,
            status: 'PENDING',
            createdAt: new Date('2026-02-01T10:00:00.000Z'),
          }),
          product: product1,
        };

        const globalSettings = makeGlobalSettings({
          hourlyRate: 10,
          investmentRate: 0.05,
        });

        // 1st findMany call for sales list
        // 2nd findMany call for top selling products
        vi.mocked(prisma.sale.findMany)
          .mockResolvedValueOnce([sale1, sale2, sale3] as never)
          .mockResolvedValueOnce([
            { ...sale1, product: { ...product1, category: { name: 'Electronics' } } },
            { ...sale2, product: { ...product2, category: null } },
          ] as never);

        vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(globalSettings);

        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const data = response.json();

        // Gross revenue: (100*2) + (50*1) + (100*1) = 350
        expect(data.grossRevenue).toBe(350);
        // Net revenue (COMPLETED): (100*2) + (50*1) = 250
        expect(data.netRevenue).toBe(250);
        // Total orders: 3
        expect(data.totalOrders).toBe(3);
        // Net profit total: 40 + 15 + 20 = 75
        expect(data.netProfit).toBe(75);

        // Without days parameter, deltas are 0
        expect(data.grossRevenueDelta).toBe(0);
        expect(data.netProfitDelta).toBe(0);
        expect(data.totalOrdersDelta).toBe(0);

        // Monthly stats grouped by YYYY-MM
        expect(data.monthlyStats).toHaveLength(2);
        expect(data.monthlyStats[0]).toEqual({
          date: '2026-01',
          grossRevenue: 250, // (100*2) + (50*1)
          costs: 6, // 2*2 + 2*1
        });
        expect(data.monthlyStats[1]).toEqual({
          date: '2026-02',
          grossRevenue: 100, // 100*1
          costs: 2, // 2*1
        });

        // Top selling
        expect(data.topSelling).toHaveLength(2);
        expect(data.topSelling[0]).toEqual({
          productId: 'prod-1',
          name: 'Product A',
          category: 'Electronics',
          quantity: 2,
        });
        expect(data.topSelling[1]).toEqual({
          productId: 'prod-2',
          name: 'Product B',
          category: null,
          quantity: 1,
        });
      });

      it('should calculate deltas when days parameter is provided', async () => {
        const product = makeProduct();

        const currentSale = {
          ...makeSale({
            id: 'current-sale',
            finalPrice: 200,
            quantity: 1,
            calculatedProfit: 50,
            status: 'COMPLETED',
          }),
          product,
        };

        const previousSale = {
          ...makeSale({
            id: 'previous-sale',
            finalPrice: 100,
            quantity: 1,
            calculatedProfit: 25,
            status: 'COMPLETED',
          }),
          product,
        };

        // Call 1: current sales
        // Call 2: previous sales
        // Call 3: top selling completed sales
        vi.mocked(prisma.sale.findMany)
          .mockResolvedValueOnce([currentSale] as never)
          .mockResolvedValueOnce([previousSale] as never)
          .mockResolvedValueOnce([{ ...currentSale, product: { ...product, category: null } }] as never);

        vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);

        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          query: { days: '30' },
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const data = response.json();

        // Current gross revenue = 200, previous = 100 -> delta = (200 - 100) / 100 = 1 (100%)
        expect(data.grossRevenueDelta).toBe(1);
        // Current net profit = 50, previous = 25 -> delta = (50 - 25) / 25 = 1 (100%)
        expect(data.netProfitDelta).toBe(1);
        // Current total orders = 1, previous = 1 -> delta = (1 - 1) / 1 = 0
        expect(data.totalOrdersDelta).toBe(0);
      });

      it('should return delta = 1 when previous sales are 0 and current sales > 0', async () => {
        const product = makeProduct();

        const currentSale = {
          ...makeSale({
            finalPrice: 100,
            quantity: 1,
            calculatedProfit: 20,
          }),
          product,
        };

        vi.mocked(prisma.sale.findMany)
          .mockResolvedValueOnce([currentSale] as never)
          .mockResolvedValueOnce([] as never) // previous sales empty
          .mockResolvedValueOnce([{ ...currentSale, product: { ...product, category: null } }] as never);

        vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);

        const response = await app.inject({
          method: 'GET',
          url: '/stats',
          query: { days: '7' },
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const data = response.json();

        expect(data.grossRevenueDelta).toBe(1);
        expect(data.netProfitDelta).toBe(1);
        expect(data.totalOrdersDelta).toBe(1);
      });
    });
  });

  describe('GET /price-evolution/:productId', () => {
    const validProductId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

    describe('Authentication & Validation', () => {
      it('should return 401 Unauthorized if no authorization header is provided', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/price-evolution/${validProductId}`,
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ message: 'Unauthorized' });
      });

      it('should return 400 Bad Request if productId is not a valid UUID', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/price-evolution/invalid-uuid',
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(400);
      });

      it('should return 400 Bad Request if days query parameter is invalid', async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/price-evolution/${validProductId}`,
          query: { days: 'invalid' },
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(400);
      });
    });

    describe('Price Evolution Data', () => {
      it('should return empty array if product has no completed sales', async () => {
        vi.mocked(prisma.sale.findMany).mockResolvedValue([]);

        const response = await app.inject({
          method: 'GET',
          url: `/price-evolution/${validProductId}`,
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([]);
        expect(prisma.sale.findMany).toHaveBeenCalledWith({
          where: { productId: validProductId, status: 'COMPLETED' },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, finalPrice: true },
        });
      });

      it('should return daily average prices for sales on different days', async () => {
        const mockSales = [
          { createdAt: new Date('2026-01-10T10:00:00.000Z'), finalPrice: 100 },
          { createdAt: new Date('2026-01-10T15:00:00.000Z'), finalPrice: 120 },
          { createdAt: new Date('2026-01-11T09:00:00.000Z'), finalPrice: 150 },
        ];

        vi.mocked(prisma.sale.findMany).mockResolvedValue(mockSales as never);

        const response = await app.inject({
          method: 'GET',
          url: `/price-evolution/${validProductId}`,
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        const data = response.json();

        expect(data).toHaveLength(2);
        // Jan 10 average: (100 + 120) / 2 = 110
        expect(data[0]).toEqual({ date: '2026-01-10', price: 110 });
        // Jan 11 average: 150 / 1 = 150
        expect(data[1]).toEqual({ date: '2026-01-11', price: 150 });
      });

      it('should apply days filter correctly when days parameter is provided', async () => {
        vi.mocked(prisma.sale.findMany).mockResolvedValue([]);

        const response = await app.inject({
          method: 'GET',
          url: `/price-evolution/${validProductId}`,
          query: { days: '14' },
          headers: { Authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(200);
        expect(prisma.sale.findMany).toHaveBeenCalledWith({
          where: {
            productId: validProductId,
            status: 'COMPLETED',
            createdAt: { gte: expect.any(Date) },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true, finalPrice: true },
        });
      });
    });
  });
});
