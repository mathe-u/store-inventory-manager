import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // List all categories
  app.get('/', async () => {
    return prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  });

  // Get single category
  app.get('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });

    if (!category) return reply.status(404).send({ message: 'Category not found' });
    return category;
  });

  // Create category
  app.post('/', async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }).parse(request.body);

    const exists = await prisma.category.findUnique({ where: { name: body.name } });
    if (exists) return reply.status(409).send({ message: 'Category already exists' });

    const category = await prisma.category.create({ data: {
      name: body.name, description: body.description ?? null,
      ...(body.color ? { color : body.color } : {})
    } });
    return reply.status(201).send(category);
  });

  // Update category
  app.put('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const body = z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    }).parse(request.body);

    const category = await prisma.category.update({
      where: { id },
      data: body,
    }).catch(() => null);

    if (!category) return reply.status(404).send({ message: 'Category not found' });
    return category;
  });

  // Delete category
  app.delete('/:id', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    // Detach products from this category before deleting
    await prisma.product.updateMany({
      where: { categoryId: id },
      data: { categoryId: null },
    });

    await prisma.category.delete({ where: { id } }).catch(() => null);
    return reply.status(204).send();
  });
}
