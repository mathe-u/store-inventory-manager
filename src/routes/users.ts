import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['ADMIN', 'SELLER']),
  isActive: z.boolean(),
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.uuid() });

export async function userRoutes(fastify: FastifyInstance) {
    const app = fastify.withTypeProvider<ZodTypeProvider>();
    // Protege todas as rotas deste arquivo exigindo autenticação JWT
    app.addHook('preHandler', app.authenticate);

    // 1. LISTAR USUÁRIOS
    app.get('/', {
      schema: {
        tags: ['Users'],
        summary: 'Listar todos os usuários',
        security: [{ BearerAuth: [] }],
        response: {
          200: z.array(userSchema),
        },
      },
    }, async () => {
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
    app.get('/:id', {
      schema: {
        tags: ['Users'],
        summary: 'Buscar usuário por ID',
        security: [{ BearerAuth: [] }],
        params: idParamSchema,
        response: {
          200: userSchema,
          404: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { id } = request.params;

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
    app.post('/', {
      schema: {
        tags: ['Users'],
        summary: 'Criar novo usuário',
        security: [{ BearerAuth: [] }],
        body: z.object({
          name: z.string().min(1),
          email: z.email(),
          password: z.string().min(6),
          role: z.enum(['ADMIN', 'SELLER']).default('SELLER'),
        }),
        response: {
          201: userSchema,
          400: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { name, email, password, role } = request.body;

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
    app.put('/:id', {
      schema: {
        tags: ['Users'],
        summary: 'Atualizar dados de um usuário',
        security: [{ BearerAuth: [] }],
        params: idParamSchema,
        body: z.object({
          name: z.string().min(1).optional(),
          email: z.email().optional(),
          password: z.string().min(6).optional(),
          role: z.enum(['ADMIN', 'SELLER']).optional(),
          isActive: z.boolean().optional(),
        }),
        response: {
          200: userSchema,
          400: errorSchema,
          404: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { id } = request.params;
        const body = request.body;

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
    app.delete('/:id', {
      schema: {
        tags: ['Users'],
        summary: 'Desativar um usuário',
        security: [{ BearerAuth: [] }],
        params: idParamSchema,
        response: {
          204: z.null(),
          404: errorSchema,
        },
      },
    }, async (request, reply) => {
        const { id } = request.params;

        const existingUser = await prisma.user.findUnique({ where: { id } });
        if (!existingUser) {
            return reply.status(404).send({ message: 'User not found' });
        }

        await prisma.user.update({
            where: { id },
            data: { isActive: false },
        });

        return reply.status(204).send(null);
    });
}
