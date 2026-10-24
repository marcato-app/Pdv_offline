import type { ComponentType } from 'react';
import * as L from 'lucide-react';
import type { Product } from '../lib/db';

// Imagem de exemplo para produto sem foto: um ícone pelo tipo do produto (árvore mercadológica),
// na cor do segmento. Ícones Lucide (licença ISC, uso livre).

type Icon = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
const I = L as unknown as Record<string, Icon>;

// Do mais específico para o mais geral. Testado no texto: tipo, subcategoria, categoria, departamento e descrição.
const RULES: [RegExp, string][] = [
  [/CERVEJA|CHOPP/, 'Beer'], [/VINHO|ESPUMANTE|VERMOUTH/, 'Wine'], [/WHISKY|VODKA|CACHACA|GIN|RUM|TEQUILA|CONHAQUE|LICOR|SAQUE|APERITIVO|DESTILAD|MISTURA ALCOOL|DRINK|COQUETEL/, 'Martini'],
  [/REFRIGERANTE|ENERGETICO|ISOTONICO|CHA PRONTO/, 'CupSoda'], [/AGUA DE COCO|SUCO|POLPA|ACAI/, 'Citrus'], [/AGUA|GELO/, 'GlassWater'],
  [/CAFE|CAPSULA/, 'Coffee'], [/\bCHA\b|CHAS|ERVA/, 'Leaf'],
  [/LEITE|IOGURTE|BEBIDA LACTEA|PETIT SUISSE|COALHADA|NATA|CREME DE LEITE|REQUEIJAO|CREAM CHEESE/, 'Milk'],
  [/QUEIJO|MANTEIGA|MARGARINA|FIAMBRE|FRIOS/, 'Ham'],
  [/SORVETE|PICOLE|GELADINHO|ACAI/, 'IceCreamCone'], [/CHOCOLATE|OVO DE PASCOA|BOMBOM/, 'CakeSlice'], [/BALA|PIRULITO|GOMA|DOCE|GOIABADA|GELEIA|MEL\b|CONFEIT|SOBREMESA/, 'Candy'],
  [/BISCOITO|BOLACHA|TORRADA|WAFER/, 'Cookie'], [/PAO|BOLO|PANETONE|TORTA|SALGADO DE PADARIA|PADARIA|LANCHE/, 'Croissant'], [/PIZZA|LASANHA|PRATO PRONTO|REFEICAO|EMPANADO|HAMBURGUER|SALGADO CONGELADO|ALMONDEGA/, 'Pizza'],
  [/PIPOCA|MILHO PARA PIPOCA/, 'Popcorn'], [/AMENDOIM|CASTANHA|NUTS|AVELA|NOZ/, 'Nut'], [/FEIJAO|GRAO|LENTILHA|ERVILHA|SOJA/, 'Bean'],
  [/ARROZ|FARINHA|AVEIA|CEREAL|GRANOLA|AMIDO|FERMENTO|MASSA|MACARRAO|FAROFA|TRIGO/, 'Wheat'], [/ACUCAR|ADOCANTE|EDULCORANTE|XAROPE/, 'Candy'],
  [/OLEO|AZEITE|GORDURA|VINAGRE/, 'Droplet'], [/SAL\b|TEMPERO|CALDO|ESPECIARIA|PIMENTA|CONDIMENTO|MOLHO|KETCHUP|MAIONESE|MOSTARDA|ATOMATADO/, 'Flame'],
  [/SOPA|CREME$|PAPINHA|SOPA E CREME/, 'Soup'], [/ATUM|SARDINHA|PEIXE|BACALHAU|FRUTOS DO MAR|CAMARAO|PESCADO/, 'Fish'], [/CONSERVA|ENLATAD|SELETA|PATE/, 'Container'],
  [/OVO/, 'Egg'], [/FRANGO|AVE|AVICOLA/, 'Drumstick'], [/BOVINO|SUINO|CORDEIRO|CARNE|ACOUGUE|LINGUICA|SALSICHA|DEFUMADO/, 'Beef'],
  [/FRUTA|BANANA|MACA|LARANJA|UVA|MAMAO|MELAO|MELANCIA/, 'Apple'], [/LEGUME|VERDURA|VEGETAL|SALADA|TOMATE|BATATA|CENOURA|HORTI/, 'Carrot'],
  [/CONGELAD/, 'Snowflake'], [/CESTA/, 'ShoppingBasket'],
  // Limpeza
  [/SABAO|LAVA ROUPA|AMACIANTE|ALVEJANTE|TIRA MANCHA|PASSAR ROUPA|LAVANDERIA/, 'WashingMachine'], [/DETERGENTE|ESPONJA|LA DE ACO|SAPONACEO|SECANTE/, 'Sparkles'],
  [/VASSOURA|RODO|PA\b|ESCOVA SANITARIA|ESCOVA DE LAVANDERIA|ESFREGAO|BALDE|PANO/, 'Brush'], [/LIXO/, 'Package'], [/INSETICIDA|REPELENTE/, 'Bug'],
  [/AGUA SANITARIA|DESINFETANTE|LIMPADOR|ALCOOL|CERA|LUSTRA|PURIFICADOR|DESODORIZADOR|DESENGORDURANTE|POLIDOR|MOFO|LIMPEZA/, 'SprayCan'],
  // Higiene e beleza
  [/FRALDA|BEBE|INFANTIL|ASSADURA|MAMADEIRA|CHUPETA/, 'Baby'], [/SHAMPOO|CONDICIONADOR|CAPILAR|CABELO|PENTE/, 'ShowerHead'], [/CREME DENTAL|ESCOVA DENTAL|FIO DENTAL|BUCAL/, 'Smile'],
  [/SABONETE|BANHO|DESODORANTE|HIDRATANTE|CORPO|TALCO|PROTETOR SOLAR|BRONZEADOR|POS SOL/, 'Bath'], [/MAQUIAGEM|ESMALTE|UNHA|MANICURE|COSMETIC|FRAGRANCIA|BATOM/, 'Sparkles'],
  [/BARBEADOR|BARBA|DEPILA|CUTELARIA/, 'Scissors'], [/PAPEL HIGIENICO|LENCO|TOALHA DE PAPEL|GUARDANAPO/, 'Package'], [/ABSORVENTE|PROTETOR DIARIO|PRESERVATIVO|ALGODAO|HASTE/, 'HeartPulse'],
  // Pet, saúde, tabaco
  [/GATO/, 'Cat'], [/PET|CACHORRO|CAO|RACAO/, 'Dog'], [/MEDICAMENTO|FARMACIA|ANALGES|VITAMIN|SUPLEMENTO|COMPLEMENTO/, 'Pill'], [/CIGARRO|TABACO|ISQUEIRO/, 'Cigarette'],
  // Bazar, casa, eletro, têxtil
  [/VELA|ACENDEDOR|FOSFORO|INCENSO|CHURRASQ|CARVAO/, 'Flame'], [/CADERNO|CANETA|LAPIS|PAPELARIA|AGENDA|BLOCO|SULFITE|ESCOLAR|ESCRITA|LIVRO/, 'Pencil'], [/COLA|FITA ADESIVA|TESOURA|ELASTICO/, 'Scissors'],
  [/BRINQUEDO|FESTA|DECORACAO|COMEMORATIVO/, 'Gift'], [/DESCARTAVEL|EMBALAGEM|COPO|PRATO|FILTRO DE CAFE/, 'Utensils'], [/COZINHA|UTILIDADE|GARRAFA|PANELA/, 'CookingPot'],
  [/AUTOMOTIV|PNEU/, 'Car'], [/CAMPING|ESPORTE/, 'Tent'], [/MOVEL|MOVEIS/, 'Sofa'], [/ILUMINACAO|LAMPADA|LUZ/, 'Lightbulb'], [/PILHA|BATERIA/, 'Battery'], [/ELETRIC|TOMADA|FIO/, 'Plug'],
  [/FERRAMENTA|FERRAGEM|FIXACAO|PARAFUSO/, 'Wrench'], [/PINTURA|TINTA|PINCEL/, 'Paintbrush'], [/JARDIM|MANGUEIRA|PLANTA/, 'Sprout'], [/HIDRAULIC|DUCHA|CHUVEIRO|TORNEIRA/, 'ShowerHead'],
  [/CELULAR|DISPOSITIVO MOVEL|CARREGADOR|CABO/, 'Smartphone'], [/AUDIO|VIDEO|FONE/, 'Headphones'], [/GELADEIRA|FREEZER/, 'Refrigerator'], [/ELETRODOMESTICO|PEQUENO DOMESTICO|MICROONDAS/, 'Microwave'],
  [/CAMA|MESA E BANHO|TOALHA/, 'BedDouble'], [/CHINELO|SANDALIA|TENIS|SAPATO/, 'Footprints'], [/VESTUARIO|ROUPA|CAMISETA|MEIA/, 'Shirt'],
];

const SEG: Record<string, [string, string, string]> = {
  // segmento: [ícone padrão, fundo, cor]
  'CESTA BÁSICA': ['ShoppingBasket', '#FEF3E2', '#B45309'],
  'MERCEARIA GERAL': ['ShoppingBasket', '#FEF3E2', '#C2410C'],
  'BEBIDAS': ['CupSoda', '#E0F2FE', '#0369A1'],
  'FRESCOS E PERECÍVEIS': ['Carrot', '#DCFCE7', '#15803D'],
  'LIMPEZA E LAVANDERIA': ['SprayCan', '#E0F7FA', '#0E7490'],
  'HIGIENE E BELEZA': ['Sparkles', '#FCE7F3', '#BE185D'],
  'FARMÁCIA E SAÚDE': ['Pill', '#FEE2E2', '#B91C1C'],
  'MUNDO PET': ['PawPrint', '#EDE9FE', '#6D28D9'],
  'UTILIDADES E BAZAR': ['Package', '#F1F5F9', '#475569'],
  'CASA, OBRA E FERRAMENTAS': ['Hammer', '#F5F5F4', '#57534E'],
  'ELETRO E TECNOLOGIA': ['Plug', '#E0E7FF', '#4338CA'],
  'TÊXTIL E VESTUÁRIO': ['Shirt', '#F3E8FF', '#7E22CE'],
  'TABACARIA': ['Cigarette', '#F5F5F4', '#44403C'],
};

// Sem segmento (cadastro antigo): a cor sai do tipo de produto reconhecido.
const ICON_SEG: [string, string[]][] = [
  ['BEBIDAS', ['Beer', 'Wine', 'Martini', 'CupSoda', 'Citrus', 'GlassWater', 'Coffee', 'Leaf']],
  ['FRESCOS E PERECÍVEIS', ['Milk', 'Ham', 'IceCreamCone', 'Croissant', 'Pizza', 'Fish', 'Egg', 'Drumstick', 'Beef', 'Apple', 'Carrot', 'Snowflake']],
  ['MERCEARIA GERAL', ['CakeSlice', 'Candy', 'Cookie', 'Popcorn', 'Nut', 'Bean', 'Wheat', 'Droplet', 'Flame', 'Soup', 'Container', 'ShoppingBasket']],
  ['LIMPEZA E LAVANDERIA', ['WashingMachine', 'Brush', 'Bug', 'SprayCan']],
  ['HIGIENE E BELEZA', ['Baby', 'ShowerHead', 'Smile', 'Bath', 'Sparkles', 'Scissors', 'HeartPulse']],
  ['MUNDO PET', ['Cat', 'Dog']], ['FARMÁCIA E SAÚDE', ['Pill']], ['TABACARIA', ['Cigarette']],
];
const segOfIcon = (icon: string) => SEG[ICON_SEG.find(([, l]) => l.includes(icon))?.[0] || ''];

const norm = (s?: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function artFor(p?: Partial<Product> | null): { icon: string; bg: string; fg: string } {
  const known = SEG[p?.segment || ''];
  const seg = known || ['ShoppingBasket', '#F1F5F9', '#64748B'];
  const texts = [p?.family, p?.subcategory, p?.category, p?.department, p?.description].map(norm).filter(Boolean);
  for (const t of texts) for (const [rx, icon] of RULES) if (rx.test(t) && I[icon]) {
    const c = known || segOfIcon(icon) || seg;
    return { icon, bg: c[1], fg: c[2] };
  }
  return { icon: seg[0], bg: seg[1], fg: seg[2] };
}

/** Quadro com o ícone do tipo de produto (no lugar da foto). */
export function CategoryArt({ product, size = 120 }: { product?: Partial<Product> | null; size?: number }) {
  const a = artFor(product);
  const Ico = I[a.icon] || I.ShoppingBasket;
  return (
    <div className="cat-art" style={{ width: size, height: size, background: a.bg, color: a.fg }} title="Imagem de exemplo (produto sem foto)">
      <Ico size={Math.round(size * 0.46)} strokeWidth={1.6} />
    </div>
  );
}
