import { type FastifyInstance } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

const saleStatusEnum = z.enum(['COMPLETED', 'LOSS', 'RETURNED', 'PENDING']);

const saleSchema = z.object({
  id: z.string(),
  productId: z.string(),
  quantity: z.number(),
  finalPrice: z.number(),
  calculatedProfit: z.number(),
  status: saleStatusEnum,
  customerName: z.string().nullable(),
  paymentMethodId: z.string(),
  createdAt: z.date(),
});

const errorSchema = z.object({ message: z.string() });
const idParamSchema = z.object({ id: z.uuid() });

const createSaleBodySchema = z.object({
  productId: z.uuid(),
  quantity: z.number().int().min(1),
  finalPrice: z.number(),
  status: saleStatusEnum.default('PENDING'),
  customerName: z.string().optional().nullable(),
  paymentMethodId: z.string().default('cash'),
});

const saleQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  productName: z.string().optional(),
  status: saleStatusEnum.optional(),
});

const paginatedSalesSchema = z.object({
  sales: z.array(z.any()),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export async function saleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.post('/', {
    schema: {
      tags: ['Sales'],
      summary: 'Registrar nova venda',
      security: [{ BearerAuth: [] }],
      body: createSaleBodySchema,
      response: {
        200: z.object({
          sale: saleSchema,
          stockRemaining: z.number(),
        }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { productId, quantity, finalPrice, status, customerName, paymentMethodId } = request.body;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
        });

        if (!product) {
          throw new Error('Product not found');
        }

        // Check stock only if status is COMPLETED or LOSS
        if ((status === 'COMPLETED' || status === 'LOSS') && product.stockQuantity < quantity) {
          throw new Error('Insufficient stock');
        }

        const settings = await tx.globalSettings.findUnique({ where: { id: 'default' } });
        const hourlyRate = settings?.hourlyRate ?? 0;
        const investmentRate = settings?.investmentRate ?? 0;

        // Calculate pricing
        const pricing = PricingService.calculate({
          acquisitionCost: product.acquisitionCost,
          shippingCost: product.shippingCost,
          taxRate: product.taxRate,
          directCosts: product.directCosts,
          investmentRate: investmentRate,
          timeSpent: product.timeSpent,
          lossIndex: product.lossIndex,
          desiredMargin: product.desiredMargin,
          hourlyRate,
        });

        const actualFinalPrice = (status === 'LOSS' || status === 'RETURNED') ? 0 : finalPrice;
        const saleProfit = status === 'LOSS'
          ? -pricing.totalBaseCost * quantity
          : status === 'RETURNED'
            ? 0
            : pricing.marginAtPrice(finalPrice).netProfit * quantity;

        // Create sale record
        const sale = await tx.sale.create({
          data: {
            productId,
            quantity,
            finalPrice: actualFinalPrice,
            calculatedProfit: saleProfit,
            status,
            customerName: customerName || null,
            paymentMethodId: paymentMethodId,
          },
        });

        // Decrement stock only if status is COMPLETED or LOSS
        if (status === 'COMPLETED' || status === 'LOSS') {
          await tx.product.update({
            where: { id: productId },
            data: { stockQuantity: { decrement: quantity } },
          });
        }

        // Recalculate lossIndex based on sales: lossIndex = totalLost / (totalSold + totalLost)
        const productSales = await tx.sale.findMany({
          where: { productId },
          select: { status: true, quantity: true },
        });

        const totalLost = productSales
          .filter((s) => s.status === 'LOSS')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalSold = productSales
          .filter((s) => s.status === 'COMPLETED')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalItems = totalSold + totalLost;
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) : 0;

        const updatedProduct = await tx.product.update({
          where: { id: productId },
          data: { lossIndex },
        });

        return { sale, stockRemaining: updatedProduct.stockQuantity };
      });

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Product not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Insufficient stock') {
          return reply.status(400).send({ message: error.message });
        }
      }
      throw error;
    }
  });

  app.get('/', {
    schema: {
      tags: ['Sales'],
      summary: 'Listar vendas',
      security: [{ BearerAuth: [] }],
      querystring: saleQuerySchema,
      response: {
        200: paginatedSalesSchema,
      },
    },
  }, async (request) => {
    const { page, limit, productName, status } = request.query;

    const where = {
      ...(status ? { status } : {}),
      ...(productName ? {
        product: {
          name: { contains: productName }
        }
      } : {}),
    };

    const skip = (page - 1) * limit;
    const take = limit;

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take,
        include: {
          product: {
            include: {
              category: true,
            },
          },
          paymentMethod: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.sale.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      sales,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  });

  app.put('/:id', {
    schema: {
      tags: ['Sales'],
      summary: 'Atualizar venda',
      security: [{ BearerAuth: [] }],
      params: idParamSchema,
      body: z.object({
        quantity: z.number().int().min(1).optional(),
        finalPrice: z.number().optional(),
        status: saleStatusEnum.optional(),
        customerName: z.string().optional().nullable(),
        paymentMethodId: z.string().optional(),
      }),
      response: {
        200: z.object({
          sale: saleSchema,
          stockRemaining: z.number(),
        }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const oldSale = await tx.sale.findUnique({
          where: { id },
        });

        if (!oldSale) {
          throw new Error('Sale not found');
        }

        const product = await tx.product.findUnique({
          where: { id: oldSale.productId },
        });

        if (!product) {
          throw new Error('Product not found');
        }

        const newQuantity = body.quantity ?? oldSale.quantity;
        const newStatus = body.status ?? oldSale.status;
        const newFinalPrice = body.finalPrice ?? oldSale.finalPrice;

        // Calculate virtual stock (revert old sale stock effect)
        let virtualStock = product.stockQuantity;
        if (oldSale.status === 'COMPLETED' || oldSale.status === 'LOSS') {
          virtualStock += oldSale.quantity;
        }

        // Check stock and calculate new stock quantity
        let newStockQuantity = virtualStock;
        if (newStatus === 'COMPLETED' || newStatus === 'LOSS') {
          if (virtualStock < newQuantity) {
            throw new Error('Insufficient stock');
          }
          newStockQuantity = virtualStock - newQuantity;
        }

        const settings = await tx.globalSettings.findUnique({ where: { id: 'default' } });
        const hourlyRate = settings?.hourlyRate ?? 0;
        const investmentRate = settings?.investmentRate ?? 0;

        // Calculate pricing based on current product costs
        const pricing = PricingService.calculate({
          acquisitionCost: product.acquisitionCost,
          shippingCost: product.shippingCost,
          taxRate: product.taxRate,
          directCosts: product.directCosts,
          investmentRate,
          timeSpent: product.timeSpent,
          lossIndex: product.lossIndex,
          desiredMargin: product.desiredMargin,
          hourlyRate,
        });

        const actualFinalPrice = (newStatus === 'LOSS' || newStatus === 'RETURNED') ? 0 : newFinalPrice;
        const saleProfit = newStatus === 'LOSS'
          ? -pricing.totalBaseCost * newQuantity
          : newStatus === 'RETURNED'
            ? 0
            : pricing.marginAtPrice(newFinalPrice).netProfit * newQuantity;

        // Update the sale
        const updatedSale = await tx.sale.update({
          where: { id },
          data: {
            quantity: newQuantity,
            finalPrice: actualFinalPrice,
            calculatedProfit: saleProfit,
            status: newStatus,
            customerName: body.customerName !== undefined ? body.customerName : oldSale.customerName,
            paymentMethodId: body.paymentMethodId !== undefined ? body.paymentMethodId : oldSale.paymentMethodId,
          },
        });

        // Update product stock
        await tx.product.update({
          where: { id: oldSale.productId },
          data: { stockQuantity: newStockQuantity },
        });

        // Recalculate lossIndex based on sales
        const productSales = await tx.sale.findMany({
          where: { productId: oldSale.productId },
          select: { status: true, quantity: true },
        });

        const totalLost = productSales
          .filter((s) => s.status === 'LOSS')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalSold = productSales
          .filter((s) => s.status === 'COMPLETED')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalItems = totalSold + totalLost;
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) : 0;

        await tx.product.update({
          where: { id: oldSale.productId },
          data: { lossIndex },
        });

        return { sale: updatedSale, stockRemaining: newStockQuantity };
      });

      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Sale not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Product not found') {
          return reply.status(404).send({ message: error.message });
        }
        if (error.message === 'Insufficient stock') {
          return reply.status(400).send({ message: error.message });
        }
      }
      throw error;
    }
  });

  app.delete('/:id', {
    schema: {
      tags: ['Sales'],
      summary: 'Remover venda (restaura estoque se COMPLETED/LOSS)',
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
      await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({
          where: { id },
        });

        if (!sale) {
          throw new Error('Sale not found');
        }

        // Restore stock if COMPLETED or LOSS
        if (sale.status === 'COMPLETED' || sale.status === 'LOSS') {
          await tx.product.update({
            where: { id: sale.productId },
            data: { stockQuantity: { increment: sale.quantity } },
          });
        }

        // Delete sale
        await tx.sale.delete({
          where: { id },
        });

        // Recalculate lossIndex for this product
        const productSales = await tx.sale.findMany({
          where: { productId: sale.productId },
          select: { status: true, quantity: true },
        });

        const totalLost = productSales
          .filter((s) => s.status === 'LOSS')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalSold = productSales
          .filter((s) => s.status === 'COMPLETED')
          .reduce((acc, s) => acc + s.quantity, 0);

        const totalItems = totalSold + totalLost;
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) : 0;

        await tx.product.update({
          where: { id: sale.productId },
          data: { lossIndex },
        });
      });

      return reply.status(204).send(null);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Sale not found') {
          return reply.status(404).send({ message: error.message });
        }
      }
      throw error;
    }
  });
}
