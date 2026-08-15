import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const categoryWithCountSchema = categorySchema.extend({
  _count: z.object({ products: z.number() }),
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.uuid() });

export async function categoryRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  // List all categories
  app.get('/', {
    schema: {
      tags: ['Categories'],
      summary: 'Listar todas as categorias',
      security: [{ BearerAuth: [] }],
      querystring: z.object({ search: z.string().optional() }),
      response: {
        200: z.array(categoryWithCountSchema),
      },
    },
  }, async (request) => {
    const { search } = request.query;
    return prisma.category.findMany({
      where: search ? {
        OR: [
          { name: { contains: search } },
          { description: {contains: search} },
        ]
      } : {},
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  });

  // Get single category
  app.get('/:id', {
    schema: {
      tags: ['Categories'],
      summary: 'Buscar categoria por ID',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      response: {
        200: categoryWithCountSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!category) return reply.status(404).send({ message: 'Category not found' });
    return category;
  });

  // Create category
  app.post('/', {
    schema: {
      tags: ['Categories'],
      summary: 'Criar nova categoria',
      security: [{ BearerAuth: [] }],
      body: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }),
      response: {
        201: categorySchema,
        409: errorSchema,
      },
    },
  }, async (request, reply) => {
    const body = request.body;

    const exists = await prisma.category.findUnique({ where: { name: body.name } });
    if (exists) return reply.status(409).send({ message: 'Category already exists' });

    const category = await prisma.category.create({ data: {
      name: body.name, description: body.description ?? null,
      ...(body.color ? { color : body.color } : {})
    } });
    return reply.status(201).send(category);
  });

  // Update category
  app.put('/:id', {
    schema: {
      tags: ['Categories'],
      summary: 'Atualizar categoria',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      body: z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }),
      response: {
        200: categorySchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    const category = await prisma.category.update({
      where: { id },
      data: body,
    }).catch(() => null);

    if (!category) return reply.status(404).send({ message: 'Category not found' });
    return category;
  });

  // Delete category
  app.delete('/:id', {
    schema: {
      tags: ['Categories'],
      summary: 'Remover categoria (desvincula produtos)',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      response: {
        204: z.null(),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    // Detach products from this category before deleting
    await prisma.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });

    await prisma.category.delete({ where: { id } }).catch(() => null);
    return reply.status(204).send(null);
  });
}
