import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';

export async function userRoutes(app: FastifyInstance) {
    // Protege todas as rotas deste arquivo exigindo autenticação JWT
    app.addHook('preHandler', app.authenticate);

    // 1. LISTAR USUÁRIOS
    app.get('/', async () => {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
            },
        });
        return users;
    });

    // 2. BUSCAR UM USUÁRIO POR ID
    app.get('/:id', async (request, reply) => {
        const { id } = z.object({ id: z.uuid() }).parse(request.params);

        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
            },
        });

        if (!user) {
            return reply.status(404).send({ message: 'User not found' });
        }

        return user;
    });

    // 3. CRIAR USUÁRIO
    app.post('/', async (request, reply) => {
        const createUserSchema = z.object({
            name: z.string().min(1),
            email: z.email(),
            password: z.string().min(6),
            role: z.enum(['ADMIN', 'SELLER']).default('SELLER'),
        });

        const { name, email, password, role } = createUserSchema.parse(request.body);

        const userExists = await prisma.user.findUnique({ where: { email } });
        if (userExists) {
            return reply.status(400).send({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
            },
        });

        return reply.status(201).send(user);
    });

    // 4. ATUALIZAR USUÁRIO
    app.put('/:id', async (request, reply) => {
        const { id } = z.object({ id: z.uuid() }).parse(request.params);

        const updateUserSchema = z.object({
            name: z.string().min(1).optional(),
            email: z.email().optional(),
            password: z.string().min(6).optional(),
            role: z.enum(['ADMIN', 'SELLER']).optional(),
            isActive: z.boolean().optional(),
        });

        const body = updateUserSchema.parse(request.body);

        const existingUser = await prisma.user.findUnique({ where: { id } });
        if (!existingUser) {
            return reply.status(404).send({ message: 'User not found' });
        }

        if (body.email && body.email !== existingUser.email) {
            const emailExists = await prisma.user.findUnique({ where: { email: body.email } });
            if (emailExists) {
                return reply.status(400).send({ message: 'Email already in use' });
            }
        }

        const { password, ...otherData } = body;

        const data = {
            ...otherData,
            ...(password ? { password: await bcrypt.hash(password, 10) } : {}),
        };


        const updatedUser = await prisma.user.update({
            where: { id },
            data,
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                isActive: true,
            },
        });

        return updatedUser;
    });

    // 5. DELETAR (DESATIVAR) USUÁRIO
    app.delete('/:id', async (request, reply) => {
        const { id } = z.object({ id: z.uuid() }).parse(request.params);

        const existingUser = await prisma.user.findUnique({ where: { id } });
        if (!existingUser) {
            return reply.status(404).send({ message: 'User not found' });
        }

        await prisma.user.update({
            where: { id },
            data: { isActive: false },
        });

        return reply.status(204).send();
    });
}
