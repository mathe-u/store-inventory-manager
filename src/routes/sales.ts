import { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';

export async function saleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/', async (request, reply) => {
    const saleSchema = z.object({
      productId: z.uuid(),
      quantity: z.number().int().min(1),
      finalPrice: z.number(), // Price sold in Marketplace
      status: z.enum(['COMPLETED', 'LOSS', 'RETURNED', 'PENDING']).default('COMPLETED'),
    });

    const { productId, quantity, finalPrice, status } = saleSchema.parse(request.body);

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

        let saleProfit = 0;
        let actualFinalPrice = finalPrice;

        if (status === 'LOSS') {
          actualFinalPrice = 0;
          saleProfit = -pricing.totalBaseCost * quantity;
        } else if (status === 'RETURNED') {
          actualFinalPrice = 0;
          saleProfit = 0;
        } else {
          saleProfit = pricing.marginAtPrice(finalPrice).netProfit * quantity;
        }

        // Create sale record
        const sale = await tx.sale.create({
          data: {
            productId,
            quantity,
            finalPrice: actualFinalPrice,
            calculatedProfit: saleProfit,
            status,
          },
        });

        // Decrement stock only if status is COMPLETED or LOSS
        let updatedProduct = product;
        if (status === 'COMPLETED' || status === 'LOSS') {
          updatedProduct = await tx.product.update({
            where: { id: productId },
            data: { stockQuantity: { decrement: quantity } },
          });
        }

        // Recalculate lossIndex based on sales: lossIndex = totalLost / (totalSold + totalLost) * 100
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
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) * 100 : 0;

        updatedProduct = await tx.product.update({
          where: { id: productId },
          data: { lossIndex },
        });

        return { sale, stockRemaining: updatedProduct.stockQuantity };
      });

      return result;
    } catch (error: any) {
      if (error.message === 'Product not found') {
        return reply.status(404).send({ message: error.message });
      }
      if (error.message === 'Insufficient stock') {
        return reply.status(400).send({ message: error.message });
      }
      throw error;
    }
  });

  app.get('/', async () => {
    const sales = await prisma.sale.findMany({
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });
    return sales;
  });

  app.put('/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const updateSchema = z.object({
      quantity: z.number().int().min(1).optional(),
      finalPrice: z.number().optional(),
      status: z.enum(['COMPLETED', 'LOSS', 'RETURNED']).optional(),
    });

    const body = updateSchema.parse(request.body);

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

        // Calculate pricing based on current product costs
        const pricing = PricingService.calculate({
          itemPrice: product.acquisitionCost,
          shippingCost: product.shippingCost,
          taxRate: product.taxRate,
          directCosts: product.directCosts,
          timeSpent: product.timeSpent,
          lossIndex: product.lossIndex,
          desiredMargin: product.desiredMargin,
          hourlyRate,
        });

        let saleProfit = 0;
        let actualFinalPrice = newFinalPrice;

        if (newStatus === 'LOSS') {
          actualFinalPrice = 0;
          saleProfit = -pricing.totalBaseCost * newQuantity;
        } else if (newStatus === 'RETURNED') {
          actualFinalPrice = 0;
          saleProfit = 0;
        } else {
          saleProfit = pricing.marginAtPrice(newFinalPrice).netProfit * newQuantity;
        }

        // Update the sale
        const updatedSale = await tx.sale.update({
          where: { id },
          data: {
            quantity: newQuantity,
            finalPrice: actualFinalPrice,
            calculatedProfit: saleProfit,
            status: newStatus,
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

        const currentStock = product.stockQuantity;

        const totalItems = totalSold + totalLost + currentStock;
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) * 100 : 0;

        await tx.product.update({
          where: { id: oldSale.productId },
          data: { lossIndex },
        });

        return { sale: updatedSale, stockRemaining: newStockQuantity };
      });

      return result;
    } catch (error: any) {
      if (error.message === 'Sale not found') {
        return reply.status(404).send({ message: error.message });
      }
      if (error.message === 'Product not found') {
        return reply.status(404).send({ message: error.message });
      }
      if (error.message === 'Insufficient stock') {
        return reply.status(400).send({ message: error.message });
      }
      throw error;
    }
  });

  app.delete('/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

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
        const lossIndex = totalItems > 0 ? (totalLost / totalItems) * 100 : 0;

        await tx.product.update({
          where: { id: sale.productId },
          data: { lossIndex },
        });
      });

      return reply.status(204).send();
    } catch (error: any) {
      if (error.message === 'Sale not found') {
        return reply.status(404).send({ message: error.message });
      }
      throw error;
    }
  });
}
