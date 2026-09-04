import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).nullable();

const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  stockQuantity: z.number(),
  minStockAlert: z.number(),
  metadata: z.string(),
  acquisitionCost: z.number(),
  shippingCost: z.number(),
  taxRate: z.number(),
  directCosts: z.number(),
  timeSpent: z.number(),
  lossIndex: z.number(),
  desiredMargin: z.number(),
  categoryId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  category: categorySchema,
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.uuid() });

const productBodySchema = z.object({
  name: z.string(),
  imageUrl: z.string().optional(),
  stockQuantity: z.number().int().default(0),
  minStockAlert: z.number().int().default(5),
  metadata: z.record(z.string(), z.any()),
  acquisitionCost: z.number().default(0),
  shippingCost: z.number().default(0),
  taxRate: z.number().default(0),
  directCosts: z.number().default(0),
  timeSpent: z.number().default(0),
  lossIndex: z.number().default(0),
  desiredMargin: z.number().default(0.30),
  categoryId: z.uuid().optional(),
});

const productQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  // orderBy: z.enum(['role', 'createdAt']).default('createdAt'),
  // order: z.enum(['asc', 'desc']).default('desc'),
});

const paginatedProductsSchema = z.object({
  products: z.array(productSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export async function productRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  // List all products (includes category)
  app.get('/', {
    schema: {
      tags: ['Products'],
      summary: 'Listar todos os produtos',
      security: [{ BearerAuth: [] }],
      querystring: productQuerySchema,
      response: {
        200: paginatedProductsSchema,
      },
    },
  }, async (request) => {
    const { page, limit, search } = request.query;

    const filter = search
      ? {
        OR: [
          { name: { contains: search } },
          // Busca na tabela relacionada 'category' pelo campo 'name'
          { category: { name: { contains: search } } },
        ],
      }
      : {};

    const skip = (page - 1) * limit;
    const take = limit;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where: filter,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { category: true },
      }),
      prisma.product.count({ where: filter }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      products,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  });

  // Create product
  app.post('/', {
    schema: {
      tags: ['Products'],
      summary: 'Criar novo produto',
      security: [{ BearerAuth: [] }],
      body: productBodySchema,
      response: {
        201: productSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;

    const product = await prisma.product.create({
      data: {
        ...body,
        imageUrl: body.imageUrl ?? null,
        categoryId: body.categoryId ?? null,
        metadata: JSON.stringify(body.metadata),
      },
      include: { category: true },
    });

    return reply.status(201).send(product);
  });

  // Get single product with pricing calculation
  app.get('/:id', {
    schema: {
      tags: ['Products'],
      summary: 'Buscar produto por ID (com cálculo de precificação)',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      response: {
        200: productSchema.extend({
          pricing: z.object({
            totalBaseCost: z.number(),
            suggestedPrice: z.number(),
            markup: z.number(),
            netProfit: z.number(),
          }),
        }),
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: { category: true },
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

  // Update product
  app.put('/:id', {
    schema: {
      tags: ['Products'],
      summary: 'Atualizar produto',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      body: z.object({
        name: z.string().optional(),
        imageUrl: z.string().nullable().optional(),
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
        categoryId: z.uuid().nullable().optional(),
      }),
      response: {
        200: productSchema,
      },
    },
  }, async (request) => {
    const { id } = request.params;
    const body = request.body;

    const updateData = {
      ...body,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
    } as unknown as Parameters<typeof prisma.product.update>[0]['data'];

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
      include: { category: true },
    });

    return product;
  });

  // Delete product
  app.delete('/:id', {
    schema: {
      tags: ['Products'],
      summary: 'Remover produto',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      response: {
        204: z.null(),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    await prisma.product.delete({ where: { id } });
    return reply.status(204).send(null);
  });
}
