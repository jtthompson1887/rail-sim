export type ProductId = string;
export type RecipeId = string;
export type FacilityId = string;
export type FacilityDefinitionId = string;
export type CargoClass = 'bulk' | 'covered' | 'flatbed';

export interface ProductAmount {
  readonly productId: ProductId;
  readonly quantity: number;
}

export interface ProductDefinition {
  readonly id: ProductId;
  readonly displayName: string;
  readonly category: string;
  readonly cargoClass: CargoClass;
  readonly unitLabel: string;
  readonly unitMassKg: number;
  readonly unitVolumeLitres: number;
  readonly basePrice: number;
  readonly marketSector: 'construction';
}

export interface RecipeDefinition {
  readonly id: RecipeId;
  readonly kind: 'resource-extraction' | 'processing';
  readonly cycleTicks: number;
  readonly inputs: ReadonlyArray<ProductAmount>;
  readonly outputs: ReadonlyArray<ProductAmount>;
}

export interface InventorySlotDef {
  productId: ProductId;
  quantity: number;
  reservedQuantity: number;
  capacity: number;
  recentInflow: number;
  recentOutflow: number;
  targetStock: number;
}

export interface FacilityDefinition {
  readonly id: FacilityDefinitionId;
  readonly displayName: string;
  readonly recipeIds: ReadonlyArray<RecipeId>;
  readonly inventory: ReadonlyArray<{
    readonly productId: ProductId;
    readonly capacity: number;
    readonly targetStock: number;
    readonly initialQuantity: number;
  }>;
  readonly boundary: 'none' | 'port' | 'town-consumer';
}
