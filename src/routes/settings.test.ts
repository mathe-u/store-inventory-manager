import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { settingsRoutes } from "./settings.js";
import { prisma } from '../lib/prisma.js';
import { makeGlobalSettings } from "../tests/factories/settings-factory.js";
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    globalSettings: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
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

  await app.register(settingsRoutes);

  return app;
}

describe('Settings Routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
    vi.spyOn(console, 'error').mockImplementation(() => { });
    token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
  });

  describe('Authentication Hook', () => {
    it('should return 401 Unauthorized if no authorization header is provided on GET /', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: 'Unauthorized' });
    });

    it('should return 401 Unauthorized if invalid token is provided on GET /', async () => {
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

    it('should return 401 Unauthorized if no authorization header is provided on PUT /', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/',
        payload: {
          hourlyRate: 20,
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ message: 'Unauthorized' });
    });
  });

  describe('GET /', () => {
    it('should return global settings if they exist in database', async () => {
      const mockSettings = makeGlobalSettings({
        hourlyRate: 25,
        defaultTaxRate: 0.15,
        fixedMonthlyCosts: 1000,
        variableMonthlyCosts: 500,
        investmentRate: 0.1,
      });

      vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(mockSettings);

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(mockSettings);
      expect(prisma.globalSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'default' },
      });
      expect(prisma.globalSettings.create).not.toHaveBeenCalled();
    });

    it('should create and return default settings if they do not exist in database', async () => {
      const defaultSettings = makeGlobalSettings();

      vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.globalSettings.create).mockResolvedValue(defaultSettings);

      const response = await app.inject({
        method: 'GET',
        url: '/',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(defaultSettings);
      expect(prisma.globalSettings.findUnique).toHaveBeenCalledWith({
        where: { id: 'default' },
      });
      expect(prisma.globalSettings.create).toHaveBeenCalledWith({
        data: { id: 'default' },
      });
    });
  });

  describe('PUT /', () => {
    it('should update and return the settings with valid payload', async () => {
      const updateData = {
        hourlyRate: 35.5,
        defaultTaxRate: 0.18,
        fixedMonthlyCosts: 1200,
        variableMonthlyCosts: 600,
        investmentRate: 0.12,
      };

      const updatedSettings = makeGlobalSettings(updateData);

      vi.mocked(prisma.globalSettings.upsert).mockResolvedValue(updatedSettings);

      const response = await app.inject({
        method: 'PUT',
        url: '/',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: updateData,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(updatedSettings);
      expect(prisma.globalSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        update: updateData,
        create: { id: 'default', ...updateData },
      });
    });

    it('should allow partial updates', async () => {
      const updateData = {
        hourlyRate: 40,
      };

      const updatedSettings = makeGlobalSettings({ hourlyRate: 40 });

      vi.mocked(prisma.globalSettings.upsert).mockResolvedValue(updatedSettings);

      const response = await app.inject({
        method: 'PUT',
        url: '/',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: updateData,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(updatedSettings);
      expect(prisma.globalSettings.upsert).toHaveBeenCalledWith({
        where: { id: 'default' },
        update: updateData,
        create: { id: 'default', ...updateData },
      });
    });

    it('should return 400 Bad Request on validation errors if fields have wrong type', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        payload: {
          hourlyRate: 'invalid-string-instead-of-number',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(prisma.globalSettings.upsert).not.toHaveBeenCalled();
    });
  });
});
