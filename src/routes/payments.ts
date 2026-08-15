import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const DEFAULT_PAYMENT_METHODS = [
    { id: 'cash', name: 'Dinheiro', icon: 'payments' },
    { id: 'pix', name: 'Pix', icon: 'send_money' },
    { id: 'credit_card', name: 'Cartão de crédito', icon: 'account_balance_wallet' },
    { id: 'other', name: 'Outros', icon: 'more_horiz' },
];

const paymentMethodSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.string() });

export async function paymentRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    app.addHook('preHandler', app.authenticate);

    app.get('/seed', {
      schema: {
        tags: ['Payments'],
        summary: 'Popular métodos de pagamento padrão',
        security: [{ BearerAuth: [] }],
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    }, async () => {
        for (const method of DEFAULT_PAYMENT_METHODS) {
            await prisma.paymentMethod.upsert({
                where: { id: method.id },
                update: {},
                create: method,
            });
        }
        return { message: 'Default payment methods seeded' };
    });

    app.get('/', {
      schema: {
        tags: ['Payments'],
        summary: 'Listar métodos de pagamento',
        security: [{ BearerAuth: [] }],
        response: {
          200: z.array(paymentMethodSchema),
        },
      },
    }, async () => {
        return prisma.paymentMethod.findMany({
            orderBy: { name: 'asc' },
        });
    });

    app.post('/', {
      schema: {
        tags: ['Payments'],
        summary: 'Criar método de pagamento',
        security: [{ BearerAuth: [] }],
        body: z.object({
          id: z.string().optional(),
          name: z.string().min(1),
          icon: z.string().optional().nullable(),
        }),
        response: {
          201: paymentMethodSchema,
        },
      },
    }, async (request, reply) => {
        const data = request.body;

        const method = await prisma.paymentMethod.create({
            data: {
                id: data.id,
                name: data.name,
                icon: data.icon ?? null,
            },
        });

        return reply.status(201).send(method);
    });

    app.put('/:id', {
      schema: {
        tags: ['Payments'],
        summary: 'Atualizar método de pagamento',
        security: [{ BearerAuth: [] }],
        params: idParamSchema,
        body: z.object({
          name: z.string().min(1).optional(),
          icon: z.string().optional().nullable(),
        }),
        response: {
          200: paymentMethodSchema,
          404: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { id } = request.params;
        const data = request.body;

        try {
            const updated = await prisma.paymentMethod.update({
                where: { id },
                data,
            });
            return updated;
        } catch {
            return reply.status(404).send({ message: 'Payment method not found' });
        }
    });

    app.delete('/:id', {
      schema: {
        tags: ['Payments'],
        summary: 'Remover método de pagamento',
        security: [{ BearerAuth: [] }],
        params: idParamSchema,
        response: {
          204: z.null(),
          404: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { id } = request.params;

        try {
            await prisma.paymentMethod.delete({ where: { id } });
            return reply.status(204).send(null);
        } catch {
            return reply.status(404).send({ message: 'Payment method not found' });
        }
    });
}