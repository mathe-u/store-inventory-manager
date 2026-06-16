export interface PricingInput {
  acquisitionCost: number;
  shippingCost: number;
  taxRate: number; // percentage
  directCosts: number;
  investmentRate: number;
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
      acquisitionCost,
      shippingCost,
      taxRate,
      directCosts,
      investmentRate,
      timeSpent,
      lossIndex,
      desiredMargin,
      hourlyRate,
    } = input;

    // 1. Calculate Tax Amount
    // o calculo do imposto (ICMS) é feito com base no valor final do pedido (preco do item + frete + beneficios/descontos).
    // Outros benefícios/descontos incluem cupons, créditos, moedas etc, do AliExpress.
    // acquisitionCost = preco do item
    const discountValue = 0;
    const customsValue = acquisitionCost - discountValue + shippingCost;
    const baseICMS = customsValue / (1 - taxRate);
    const icmsTax = baseICMS * taxRate;
    const sellerWage = timeSpent * hourlyRate;

    // 2. Base Cost + sellerWage
    const totalBaseCost = acquisitionCost + shippingCost + icmsTax + directCosts + sellerWage;

    // const lossDivisor = lossIndex > 0 ? 2 : 1;
    // const marginDivisor = desiredMargin < 100 ? (1 - desiredMargin) : 1;

    // 3. Adjusted for Loss
    // Calculado automaticamente baseado nas vendas registradas como perda (LOSS)
    const costWithLoss = totalBaseCost / (1 - lossIndex);

    // 4. Suggested Price based on Desired Margin
    // Markup strategy: Price = Cost / (1 - margin)

    const suggestedPrice = costWithLoss / (1 - desiredMargin);

    // const markup = totalBaseCost > 0 ? (suggestedPrice / totalBaseCost) : 0;
    const markup = 1 / ((1 - lossIndex) * (1 - desiredMargin) * (1 - investmentRate));

    // const suggestedPrice = totalBaseCost * markup;

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
