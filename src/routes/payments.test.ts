import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { paymentRoutes } from "./payments.js";
import { prisma } from '../lib/prisma.js';
import { makePaymentMethod } from "../tests/factories/payment-method-factory.js";
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        paymentMethod: {
            upsert: vi.fn(),
            findMany: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        }
    }
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

    await app.register(paymentRoutes);

    return app;
}

describe('Payment Routes', () => {
    let app: FastifyInstance;
    let token: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await buildTestApp();
        token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
    });

    describe('Authentication Hook', () => {
        it('should return 401 Unauthorized if no authorization header is provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });

        it('should return 401 Unauthorized if invalid token is provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: {
                    Authorization: 'Bearer invalid-token',
                },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });
    });

    describe('GET /seed (Seed Default Payment Methods)', () => {
        it('should seed default payment methods and return 200', async () => {
            vi.mocked(prisma.paymentMethod.upsert).mockResolvedValue(makePaymentMethod({ id: 'cash' }));

            const response = await app.inject({
                method: 'GET',
                url: '/seed',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ message: 'Default payment methods seeded' });
            expect(prisma.paymentMethod.upsert).toHaveBeenCalledTimes(4);
            expect(prisma.paymentMethod.upsert).toHaveBeenNthCalledWith(1, {
                where: { id: 'cash' },
                update: {},
                create: { id: 'cash', name: 'Dinheiro', icon: 'payments' },
            });
        });
    });

    describe('GET / (List Payment Methods)', () => {
        it('should list all payment methods sorted by name', async () => {
            const methods = [
                makePaymentMethod({ id: 'pix', name: 'Pix' }),
                makePaymentMethod({ id: 'cash', name: 'Dinheiro' }),
            ];

            vi.mocked(prisma.paymentMethod.findMany).mockResolvedValue(methods);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(2);
            expect(body[0].id).toBe('pix');
            expect(body[1].id).toBe('cash');
            expect(prisma.paymentMethod.findMany).toHaveBeenCalledWith({
                orderBy: { name: 'asc' },
            });
        });
    });

    describe('POST / (Create Payment Method)', () => {
        it('should return 400 Bad Request if name is missing or empty', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    icon: 'wallet',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('name');
            expect(prisma.paymentMethod.create).not.toHaveBeenCalled();
        });

        it('should create and return 201 Created on success', async () => {
            const created = makePaymentMethod({
                id: 'custom-method',
                name: 'Voucher',
                icon: 'receipt',
            });

            vi.mocked(prisma.paymentMethod.create).mockResolvedValue(created);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    id: 'custom-method',
                    name: 'Voucher',
                    icon: 'receipt',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(201);
            const body = response.json();
            expect(body.id).toBe('custom-method');
            expect(body.name).toBe('Voucher');
            expect(body.icon).toBe('receipt');
            expect(prisma.paymentMethod.create).toHaveBeenCalledWith({
                data: {
                    id: 'custom-method',
                    name: 'Voucher',
                    icon: 'receipt',
                },
            });
        });

        it('should allow creating a payment method without explicitly passing id and icon', async () => {
            const created = makePaymentMethod({
                id: 'generated-uuid-id',
                name: 'Bank Transfer',
                icon: null,
            });

            vi.mocked(prisma.paymentMethod.create).mockResolvedValue(created);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Bank Transfer',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(201);
            const body = response.json();
            expect(body.id).toBe('generated-uuid-id');
            expect(body.name).toBe('Bank Transfer');
            expect(body.icon).toBeNull();
            expect(prisma.paymentMethod.create).toHaveBeenCalledWith({
                data: {
                    id: undefined,
                    name: 'Bank Transfer',
                    icon: null,
                },
            });
        });
    });

    describe('PUT /:id (Update Payment Method)', () => {
        it('should return 400 Bad Request if name is an empty string', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/pix',
                payload: {
                    name: '',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.paymentMethod.update).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if payment method does not exist', async () => {
            vi.mocked(prisma.paymentMethod.update).mockRejectedValue(new Error('Record not found'));

            const response = await app.inject({
                method: 'PUT',
                url: '/non-existent',
                payload: {
                    name: 'Updated Name',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Payment method not found' });
            expect(prisma.paymentMethod.update).toHaveBeenCalledWith({
                where: { id: 'non-existent' },
                data: { name: 'Updated Name' },
            });
        });

        it('should update and return 200 OK on success', async () => {
            const updated = makePaymentMethod({
                id: 'pix',
                name: 'Pix HD',
                icon: 'star',
            });

            vi.mocked(prisma.paymentMethod.update).mockResolvedValue(updated);

            const response = await app.inject({
                method: 'PUT',
                url: '/pix',
                payload: {
                    name: 'Pix HD',
                    icon: 'star',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe('pix');
            expect(body.name).toBe('Pix HD');
            expect(body.icon).toBe('star');
        });
    });

    describe('DELETE /:id (Delete Payment Method)', () => {
        it('should return 404 Not Found if payment method to delete does not exist', async () => {
            vi.mocked(prisma.paymentMethod.delete).mockRejectedValue(new Error('Record not found'));

            const response = await app.inject({
                method: 'DELETE',
                url: '/non-existent',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Payment method not found' });
            expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({
                where: { id: 'non-existent' },
            });
        });

        it('should delete the payment method and return 204 No Content', async () => {
            vi.mocked(prisma.paymentMethod.delete).mockResolvedValue(makePaymentMethod({ id: 'pix' }));

            const response = await app.inject({
                method: 'DELETE',
                url: '/pix',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            expect(response.body).toBe('');
            expect(prisma.paymentMethod.delete).toHaveBeenCalledWith({
                where: { id: 'pix' },
            });
        });
    });
});
