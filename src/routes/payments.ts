import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const DEFAULT_PAYMENT_METHODS = [
    { id: 'cash', name: 'Dinheiro', icon: 'payments' },
    { id: 'pix', name: 'Pix', icon: 'send_money' },
    { id: 'credit_card', name: 'Cartão de crédito', icon: 'account_balance_wallet' },
    { id: 'other', name: 'Outros', icon: 'more_horiz' },
];

export async function paymentRoutes(app: FastifyInstance) {
    app.addHook('preHandler', app.authenticate);

    app.get('/seed', async () => {
        for (const method of DEFAULT_PAYMENT_METHODS) {
            await prisma.paymentMethod.upsert({
                where: { id: method.id },
                update: {},
                create: method,
            });
        }
        return { message: 'Default payment methods seeded' };
        });
    
    app.get('/', async () => {
        return prisma.paymentMethod.findMany({
            orderBy: { name: 'asc' },
        });
    });

    app.post('/', async (request, reply) => {
        const schema = z.object({
            id: z.string().optional(),
            name: z.string().min(1),
            icon: z.string().optional().nullable(),
        });
    
        const data = schema.parse(request.body);
    
        const method = await prisma.paymentMethod.create({
            data: {
                id: data.id,
                name: data.name,
                icon: data.icon ?? null,
            },
        });

        return reply.status(201).send(method);
    });

    app.put('/:id', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string() });
        const { id } = paramsSchema.parse(request.params);
    
        const bodySchema = z.object({
            name: z.string().min(1).optional(),
            icon: z.string().optional().nullable(),
        });

        const data = bodySchema.parse(request.body);

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

    app.delete('/:id', async (request, reply) => {
        const paramsSchema = z.object({ id: z.string() });
        const { id } = paramsSchema.parse(request.params);

        try {
            await prisma.paymentMethod.delete({ where: { id } });
            return reply.status(204).send();
        } catch {
            return reply.status(404).send({ message: 'Payment method not found' });
        }
    });
}