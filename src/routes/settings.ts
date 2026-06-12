import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async () => {
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

  app.put('/', async (request) => {
    const settingsSchema = z.object({
      hourlyRate: z.number().optional(),
      defaultTaxRate: z.number().optional(),
      fixedMonthlyCosts: z.number().optional(),
      variableMonthlyCosts: z.number().optional(),
      investmentRate: z.number().optional(),
    });

    const data = settingsSchema.parse(request.body);

    const settings = await prisma.globalSettings.upsert({
      where: { id: 'default' },
      update: data as unknown as Parameters<typeof prisma.globalSettings.upsert>[0]['update'],
      create: { id: 'default', ...data } as unknown as Parameters<typeof prisma.globalSettings.upsert>[0]['create'],
    });

    return settings;
  });
}
