import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const registerSchema = z.object({
      name: z.string(),
      email: z.email(),
      password: z.string().min(6),
      role: z.enum(['ADMIN', 'SELLER']).default('SELLER')
    });

    const { name, email, password, role } = registerSchema.parse(request.body);

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
    });

    return reply.status(201).send({ id: user.id, name: user.name, email: user.email, role: user.role });
  });

  app.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15m',
      }
    }
  }, async (request, reply) => {
    const loginSchema = z.object({
      email: z.email(),
      password: z.string(),
    });

    const { email, password } = loginSchema.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ sub: user.id, name: user.name, role: user.role }, { expiresIn: '2h' });

    return reply.send({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  // Rota de logout para invalidar o token atual
  app.post('/logout', { preHandler: app.authenticate }, async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return reply.status(400).send({ message: 'Missing Authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');

    // Salva o token na blacklist
    await prisma.revokedToken.create({
      data: { token }
    });

    return reply.send({ message: 'Logged out successfully' });
  });
}
