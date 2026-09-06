import { prisma } from '../lib/prisma.js';
import { PricingService } from './pricingService.js';

export type SaleStatus = 'COMPLETED' | 'LOSS' | 'RETURNED' | 'PENDING';

export interface CreateSaleInput {
  productId: string;
  quantity: number;
  finalPrice: number;
  status?: SaleStatus;
  customerName?: string | null;
  paymentMethodId?: string;
}

export interface UpdateSaleInput {
  quantity?: number;
  finalPrice?: number;
  status?: SaleStatus;
  customerName?: string | null;
  paymentMethodId?: string;
}

export interface ListSalesQuery {
  page?: number;
  limit?: number;
  productName?: string;
  status?: SaleStatus;
}

export class SalesService {
  /**
   * Helper privado para recalcular o lossIndex do produto com base nas vendas passadas
   */
  private static async recalculateLossIndex(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    productId: string
  ) {
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
    const lossIndex = totalItems > 0 ? totalLost / totalItems : 0;

    return await tx.product.update({
      where: { id: productId },
      data: { lossIndex },
    });
  }

  /**
   * Cria uma nova venda, valida estoque, calcula lucro/perda e atualiza o estoque e lossIndex do produto.
   */
  static async createSale(input: CreateSaleInput) {
    const {
      productId,
      quantity,
      finalPrice,
      status = 'PENDING',
      customerName,
      paymentMethodId = 'cash',
    } = input;

    return await prisma.$transaction(async (tx) => {
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
        investmentRate,
        timeSpent: product.timeSpent,
        lossIndex: product.lossIndex,
        desiredMargin: product.desiredMargin,
        hourlyRate,
      });

      const actualFinalPrice = status === 'LOSS' || status === 'RETURNED' ? 0 : finalPrice;
      const saleProfit =
        status === 'LOSS'
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
          paymentMethodId,
        },
      });

      // Decrement stock only if status is COMPLETED or LOSS
      if (status === 'COMPLETED' || status === 'LOSS') {
        await tx.product.update({
          where: { id: productId },
          data: { stockQuantity: { decrement: quantity } },
        });
      }

      // Recalculate lossIndex and return updated product
      const updatedProduct = await this.recalculateLossIndex(tx, productId);

      return { sale, stockRemaining: updatedProduct.stockQuantity };
    });
  }

  /**
   * Lista vendas paginadas com filtros opcionais
   */
  static async listSales(query: ListSalesQuery) {
    const { page = 1, limit = 10, productName, status } = query;

    const where = {
      ...(status ? { status } : {}),
      ...(productName
        ? {
            product: {
              name: { contains: productName },
            },
          }
        : {}),
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
  }

  /**
   * Atualiza uma venda existente e ajusta o estoque e lossIndex do produto associado.
   */
  static async updateSale(id: string, input: UpdateSaleInput) {
    return await prisma.$transaction(async (tx) => {
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

      const newQuantity = input.quantity ?? oldSale.quantity;
      const newStatus = input.status ?? oldSale.status;
      const newFinalPrice = input.finalPrice ?? oldSale.finalPrice;

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

      const actualFinalPrice = newStatus === 'LOSS' || newStatus === 'RETURNED' ? 0 : newFinalPrice;
      const saleProfit =
        newStatus === 'LOSS'
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
          customerName:
            input.customerName !== undefined ? input.customerName : oldSale.customerName,
          paymentMethodId:
            input.paymentMethodId !== undefined
              ? input.paymentMethodId
              : oldSale.paymentMethodId,
        },
      });

      // Update product stock
      await tx.product.update({
        where: { id: oldSale.productId },
        data: { stockQuantity: newStockQuantity },
      });

      // Recalculate lossIndex
      await this.recalculateLossIndex(tx, oldSale.productId);

      return { sale: updatedSale, stockRemaining: newStockQuantity };
    });
  }

  /**
   * Deleta uma venda e restaura o estoque se o status for COMPLETED ou LOSS.
   */
  static async deleteSale(id: string) {
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
      await this.recalculateLossIndex(tx, sale.productId);
    });
  }
}
