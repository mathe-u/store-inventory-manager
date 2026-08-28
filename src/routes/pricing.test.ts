import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { pricingRoutes } from "./pricing.js";
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    globalSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../services/pricingService.js', () => ({
  PricingService: {
    calculate: vi.fn(),
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

  await app.register(pricingRoutes);

  return app;
}

describe('Pricing Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
  });

  describe('Authentication Hook', () => {
    it('should return 401 Unauthorized if no authorization header is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        payload: {
          acquisitionCost: 100,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: 'Unauthorized' });
    });

    it('should return 401 Unauthorized if invalid token is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
        payload: {
          acquisitionCost: 100,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: 'Unauthorized' });
    });
  });

  describe('POST /calculate', () => {
    it('should calculate pricing with global settings from database', async () => {
      const mockSettings = {
        id: 'default',
        hourlyRate: 25,
        investmentRate: 0.15,
      };

      const mockPricingResult = {
        totalBaseCost: 120,
        suggestedPrice: 200,
        markup: 1.66,
        netProfit: 50,
        marginAtPrice: vi.fn(),
      };

      vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(mockSettings as never);
      vi.mocked(PricingService.calculate).mockReturnValue(mockPricingResult);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: {
          acquisitionCost: 100,
          shippingCost: 10,
          taxRate: 0.20,
          desiredMargin: 0.25,
          directCosts: 5,
          timeSpent: 2,
          lossIndex: 0.05,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        totalBaseCost: 120,
        suggestedPrice: 200,
        markup: 1.66,
        netProfit: 50,
      });

      expect(prisma.globalSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'default' },
      });

      expect(PricingService.calculate).toHaveBeenCalledWith({
        acquisitionCost: 100,
        shippingCost: 10,
        taxRate: 0.20,
        desiredMargin: 0.25,
        directCosts: 5,
        timeSpent: 2,
        lossIndex: 0.05,
        hourlyRate: 25,
        investmentRate: 0.15,
      });
    });

    it('should use default values for pricing fields and default to 0 for missing settings', async () => {
      const mockPricingResult = {
        totalBaseCost: 100,
        suggestedPrice: 150,
        markup: 1.5,
        netProfit: 30,
        marginAtPrice: vi.fn(),
      };

      // Simula que as configurações globais não existem
      vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);
      vi.mocked(PricingService.calculate).mockReturnValue(mockPricingResult);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: {
          acquisitionCost: 100,
          // Deixa os outros campos com valores padrão
        },
      });

      expect(response.statusCode).toBe(200);
      expect(PricingService.calculate).toHaveBeenCalledWith({
        acquisitionCost: 100,
        shippingCost: 0,
        taxRate: 0,
        desiredMargin: 0,
        directCosts: 0,
        timeSpent: 0,
        lossIndex: 0,
        hourlyRate: 0,
        investmentRate: 0,
      });
    });

    it('should include margin at specific selling price if sellingPrice is provided', async () => {
      const mockSettings = {
        id: 'default',
        hourlyRate: 20,
        investmentRate: 0.10,
      };

      const mockMarginAtPriceResult = {
        markup: 1.8,
        contributionMargin: 35,
        netProfit: 45,
      };

      const mockPricingResult = {
        totalBaseCost: 100,
        suggestedPrice: 180,
        markup: 1.8,
        netProfit: 50,
        marginAtPrice: vi.fn().mockReturnValue(mockMarginAtPriceResult),
      };

      vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(mockSettings as never);
      vi.mocked(PricingService.calculate).mockReturnValue(mockPricingResult);

      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: {
          acquisitionCost: 100,
          sellingPrice: 190,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        totalBaseCost: 100,
        suggestedPrice: 180,
        markup: 1.8,
        netProfit: 50,
        atSellingPrice: {
          markup: 1.8,
          contributionMargin: 35,
          netProfit: 45,
        },
      });

      expect(mockPricingResult.marginAtPrice).toHaveBeenCalledWith(190);
    });

    it('should return 400 Bad Request on validation errors', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/calculate',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: {
          acquisitionCost: -10, // inválido, min(0)
          taxRate: 1.5, // inválido, max(1)
        },
      });

      expect(response.statusCode).toBe(400);
      expect(PricingService.calculate).not.toHaveBeenCalled();
    });
  });
});
