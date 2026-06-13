export interface PricingInput {
  itemPrice: number;
  shippingCost: number;
  taxRate: number; // percentage
  directCosts: number;
  timeSpent: number; // hours
  lossIndex: number; // percentage
  desiredMargin: number; // percentage
  hourlyRate: number;
}

export interface PricingOutput {
  totalBaseCost: number;
  costWithLoss: number;
  suggestedPrice: number;
  markup: number;
  netProfit: number;
  marginAtPrice: (price: number) => {
    markup: number;
    contributionMargin: number;
    netProfit: number;
  };
}

export class PricingService {
  static calculate(input: PricingInput): PricingOutput {
    const {
      itemPrice,
      shippingCost,
      taxRate,
      directCosts,
      timeSpent,
      lossIndex,
      desiredMargin,
      hourlyRate,
    } = input;

    // 1. Calculate Tax Amount
    // o calculo do imposto (ICMS) é feito com base no valor final do pedido (preco do item + frete + beneficios/descontos).
    // Outros benefícios/descontos incluem cupons, créditos, moedas etc, do AliExpress.
    const discountValue = 0;

    const customsValue = itemPrice - discountValue + shippingCost;

    const baseICMS = customsValue / (1 - taxRate / 100);

    const icmsTax = baseICMS * (taxRate / 100);

    const sellerWage = timeSpent * hourlyRate;

    // 2. Base Cost + sellerWage
    const totalBaseCost = itemPrice + shippingCost + icmsTax + directCosts + sellerWage;

    // 3. Adjusted for Loss
    // Calculado automaticamente baseado nas vendas registradas como perda (LOSS)
    const costWithLoss = lossIndex > 0 ? totalBaseCost / (1 - lossIndex / 100) : totalBaseCost;

    // 4. Suggested Price based on Desired Margin
    // Markup strategy: Price = Cost / (1 - margin)
    const suggestedPrice = desiredMargin < 100 ? costWithLoss / (1 - desiredMargin / 100) : costWithLoss;

    const markup = suggestedPrice / totalBaseCost;

    return {
      totalBaseCost,
      costWithLoss,
      suggestedPrice,
      markup,
      netProfit: suggestedPrice - totalBaseCost,
      marginAtPrice: (price: number) => {
        const netProfit = price - totalBaseCost;
        const contributionMargin = price > 0 ? (netProfit / price) * 100 : 0;
        const markupAtPrice = totalBaseCost > 0 ? price / totalBaseCost : 0;

        return {
          markup: markupAtPrice,
          contributionMargin,
          netProfit,
        };
      },
    };
  }
}
