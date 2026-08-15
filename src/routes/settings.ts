import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const settingsSchema = z.object({
  id: z.string(),
  hourlyRate: z.number(),
  defaultTaxRate: z.number(),
  fixedMonthlyCosts: z.number(),
  variableMonthlyCosts: z.number(),
  investmentRate: z.number(),
});

const settingsBodySchema = z.object({
  hourlyRate: z.number().optional(),
  defaultTaxRate: z.number().optional(),
  fixedMonthlyCosts: z.number().optional(),
  variableMonthlyCosts: z.number().optional(),
  investmentRate: z.number().optional(),
});

export async function settingsRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Obter configurações globais da loja',
      security: [{ BearerAuth: [] }],
      response: {
        200: settingsSchema,
      },
    },
  }, async () => {
    const settings = await prisma.globalSettings.findUnique({
      where: { id: 'default' },
    });

    if (!settings) {
      return prisma.globalSettings.create({
        data: { id: 'default' },
      });
    }

    return settings;
  });

  app.put('/', {
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar configurações globais da loja',
      security: [{ BearerAuth: [] }],
      body: settingsBodySchema,
      response: {
        200: settingsSchema,
      },
    },
  }, async (request) => {
    const data = request.body;

    const settings = await prisma.globalSettings.upsert({
      where: { id: 'default' },
      update: data as unknown as Parameters<typeof prisma.globalSettings.upsert>[0]['update'],
      create: { id: 'default', ...data } as unknown as Parameters<typeof prisma.globalSettings.upsert>[0]['create'],
    });

    return settings;
  });
}
