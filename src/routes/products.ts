import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async () => {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return products;
  });

  app.post('/', async (request, reply) => {
    const productSchema = z.object({
      name: z.string(),
      imageUrl: z.string().optional(),
      stockQuantity: z.number().int().default(0),
      minStockAlert: z.number().int().default(5),
      metadata: z.record(z.string(), z.any()), // Frontend sends object, we stringify
      acquisitionCost: z.number().default(0),
      shippingCost: z.number().default(0),
      taxRate: z.number().default(0),
      directCosts: z.number().default(0),
      timeSpent: z.number().default(0),
      lossIndex: z.number().default(0),
      desiredMargin: z.number().default(30),
    });

    const body = productSchema.parse(request.body);

    const product = await prisma.product.create({
      data: {
        ...body,
        imageUrl: body.imageUrl ?? null,
        metadata: JSON.stringify(body.metadata),
      },
    });

    return reply.status(201).send(product);
  });

  app.get('/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.uuid() });
    const { id } = paramsSchema.parse(request.params);

    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      return reply.status(404).send({ message: 'Product not found' });
    }

    const settings = await prisma.globalSettings.findUnique({ where: { id: 'default' } });
    const hourlyRate = settings?.hourlyRate ?? 0;
    const defaultTaxRate = settings?.defaultTaxRate ?? 0;
    const investmentRate = settings?.investmentRate ?? 0;

    const pricing = PricingService.calculate({
      acquisitionCost: product.acquisitionCost,
      shippingCost: product.shippingCost,
      taxRate: defaultTaxRate,
      investmentRate: investmentRate,
      directCosts: product.directCosts,
      timeSpent: product.timeSpent,
      lossIndex: product.lossIndex,
      desiredMargin: product.desiredMargin,
      hourlyRate,
    });

    return {
      ...product,
      metadata: JSON.parse(product.metadata),
      pricing,
    };
  });

  app.put('/:id', async (request) => {
    const paramsSchema = z.object({ id: z.uuid() });
    const { id } = paramsSchema.parse(request.params);

    const productSchema = z.object({
      name: z.string().optional(),
      imageUrl: z.string().optional(),
      stockQuantity: z.number().int().optional(),
      minStockAlert: z.number().int().optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      acquisitionCost: z.number().optional(),
      shippingCost: z.number().optional(),
      taxRate: z.number().optional(),
      directCosts: z.number().optional(),
      timeSpent: z.number().optional(),
      lossIndex: z.number().optional(),
      desiredMargin: z.number().optional(),
    });

    const body = productSchema.parse(request.body);
    const updateData = {
      ...body,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
    } as unknown as Parameters<typeof prisma.product.update>[0]['data'];

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    return product;
  });

  app.delete('/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.uuid() });
    const { id } = paramsSchema.parse(request.params);

    await prisma.product.delete({ where: { id } });
    return reply.status(204).send();
  });
}
