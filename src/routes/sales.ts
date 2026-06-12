import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

export async function saleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/', async (request, reply) => {
    const saleSchema = z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().min(1),
      finalPrice: z.number(), // Price sold in Marketplace
    });

    const { productId, quantity, finalPrice } = saleSchema.parse(request.body);

    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      return reply.status(404).send({ message: 'Product not found' });
    }

    if (product.stockQuantity < quantity) {
      return reply.status(400).send({ message: 'Insufficient stock' });
    }

    const settings = await prisma.globalSettings.findUnique({ where: { id: 'default' } });
    const hourlyRate = settings?.hourlyRate ?? 0;

    // Calculate profit for this specific sale record
    const pricing = PricingService.calculate({
      acquisitionCost: product.acquisitionCost,
      shippingCost: product.shippingCost,
      taxRate: product.taxRate,
      directCosts: product.directCosts,
      timeSpent: product.timeSpent,
      lossIndex: product.lossIndex,
      desiredMargin: product.desiredMargin,
      hourlyRate,
    });

    const saleProfit = pricing.marginAtPrice(finalPrice).netProfit * quantity;

    // Update stock and create sale in a transaction
    const [updatedProduct, sale] = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { stockQuantity: { decrement: quantity } },
      }),
      prisma.sale.create({
        data: {
          productId,
          quantity,
          finalPrice,
          calculatedProfit: saleProfit,
        },
      }),
    ]);

    return { sale, stockRemaining: updatedProduct.stockQuantity };
  });

  app.get('/', async () => {
    const sales = await prisma.sale.findMany({
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
    return sales;
  });
}
