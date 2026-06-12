O foco principal desse sistema não é o processo de venda em si (já que isso ocorre no Facebook Marketplace), mas sim a **Gestão Financeira, Formação de Preço Inteligente (Precificação)** e **Controle de Estoque**.

Como você mencionou o desejo de ter o mínimo de escalabilidade caso o negócio cresça, o ideal é usar uma estrutura simples, mas bem organizada (separando as regras de negócio da infraestrutura).

Aqui está o desenho dos requisitos do MVP e as sugestões para o Frontend:

---

### 1. Sugestões de Frontend e Stack Completa

* **Framework:** **Next.js**.
* **Estilização & Componentes:** **Tailwind CSS** (para estilização rápida) combinado com **shadcn/ui** ou **Chakra UI** (para você ter tabelas, botões e formulários bonitos e prontos, sem perder tempo desenhando CSS).
* **Gráficos:** o que estiver disponivel com Next.js
* **ORM (Backend):** **Prisma** e se amanhã eu precisar mudar para o PostgreSQL, deve ser possivel.

---

### 2. Escopo Consolidado do MVP

#### Módulo 1: Autenticação & Configurações Globais

* Login simples usando JWT.
* **Configurações de Custos Fixos:** Uma tela para eu definir variáveis globais que afetam todos os produtos (ex: o valor da minha hora de trabalho, percentual de imposto padrão, ou custo fixo rateado), caso queira aplicar em lote.

#### Módulo 2: Cadastro Flexível de Produtos & Estoque

Como os atributos variam muito, a melhor abordagem de software para não travar o banco de dados é usar uma estrutura de **Metadados Dinâmicos** (guardando as variações como um objeto JSON no SQLite).

* **Campos:** ID, Nome, Imagem (upload ou URL), Quantidade em Estoque, Alerta de Estoque Baixo (número mínimo).
* **Campos Dinâmicos (JSON):** `{ "cor": "azul", "tamanho": "M", "voltagem": "127V" }`.
* **Módulo de Custos (Input):**
* Custo de Aquisição (Preço de fábrica)
* Frete de envio/aquisição
* Impostos (ICMS)
* Custos diretos (Embalagem, taxas de anúncio)
* Tempo gasto (sua hora convertida em valor)



#### Módulo 3: Motor de Precificação Inteligente (O Coração do Sistema)

o sistema deve levar em consideracao os custos variaveis mensais, dispesas fixas mensais, taxa de investimento e margem de lucro. e tambem o indice de perda do produtos.

Uma tela ou aba dentro do produto onde o sistema faz a matemática para você:

* Você insere a **Margem de Lucro Desejada** (ex: 30%) ou o **Preço de Venda Pretendido**.
* O sistema calcula em tempo real e te mostra:
* **Margem sobre a venda (Markup e Margem de Contribuição).**
* **Lucro líquido por unidade (R$).**
* **Sugestão de preço mínimo** para você não sair no prejuízo.



* Se você alterar o custo do frete ou o ICMS, o sistema recalcula instantaneamente o impacto no seu preço.

#### Módulo 4: Registro de Vendas Ocorridas

Como a venda é externa (Marketplace), você precisa de uma tela simples para dizer ao sistema que o produto saiu:

* Seleciona o produto -> Insere a quantidade vendida -> Insere o preço final pelo qual você fechou a venda no Marketplace -> Confirma.
* O sistema dá baixa no estoque e registra a transação para os gráficos.

#### Módulo 5: Dashboard Visual (BI)

Telas com gráficos interativos:

* **Faturamento Mensal e receita mensal:** Gráfico de barras (Mês a Mês).
* **Evolução de Preços:** Gráfico de linha mostrando o histórico de por quanto aquele produto foi vendido ao longo do tempo.
* **Produtos Mais Vendidos:** ranking.
* **Margem de Lucro Real:** Comparativo entre o faturamento bruto e o lucro que realmente sobrou no bolso após descontar todos os custos cadastrados.
