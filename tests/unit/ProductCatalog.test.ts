import {
  FacilityDefinition,
  ProductAmount,
  ProductDefinition,
  RecipeDefinition,
} from '../../src/economy/EconomyData';
import {
  INITIAL_FACILITY_DEFINITIONS,
  INITIAL_PRODUCTS,
  INITIAL_RECIPES,
} from '../../src/economy/InitialEconomyContent';
import {
  getFacilityDefinition,
  getProduct,
  getRecipe,
  validateEconomyContent,
} from '../../src/economy/ProductCatalog';

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

type MutableProductDefinition = Mutable<ProductDefinition>;
type MutableProductAmount = Mutable<ProductAmount>;
type MutableRecipeDefinition =
  Omit<Mutable<RecipeDefinition>, 'inputs' | 'outputs'> & {
    inputs: MutableProductAmount[];
    outputs: MutableProductAmount[];
  };
type MutableInventoryTemplate =
  Mutable<FacilityDefinition['inventory'][number]>;
type MutableFacilityDefinition =
  Omit<Mutable<FacilityDefinition>, 'recipeIds' | 'inventory'> & {
    recipeIds: string[];
    inventory: MutableInventoryTemplate[];
  };

const cloneProducts = (): MutableProductDefinition[] =>
  INITIAL_PRODUCTS.map((product) => ({ ...product }));

const cloneRecipes = (): MutableRecipeDefinition[] =>
  INITIAL_RECIPES.map((recipe) => ({
    ...recipe,
    inputs: recipe.inputs.map((amount) => ({ ...amount })),
    outputs: recipe.outputs.map((amount) => ({ ...amount })),
  }));

const cloneFacilities = (): MutableFacilityDefinition[] =>
  INITIAL_FACILITY_DEFINITIONS.map((facility) => ({
    ...facility,
    recipeIds: [...facility.recipeIds],
    inventory: facility.inventory.map((slot) => ({ ...slot })),
  }));

const validateClones = (
  products = cloneProducts(),
  recipes = cloneRecipes(),
  facilities = cloneFacilities(),
) => validateEconomyContent(products, recipes, facilities);

describe('initial economy content', () => {
  it('contains exactly the approved construction products in stable order', () => {
    expect(INITIAL_PRODUCTS.map((item) => item.id)).toEqual([
      'logs',
      'structural-timber',
      'limestone-aggregate',
      'cement',
      'steel',
      'building-modules',
    ]);
  });

  it('contains exactly the approved recipes and facilities', () => {
    expect(INITIAL_RECIPES.map((item) => item.id)).toEqual([
      'forest-harvest',
      'quarry-extraction',
      'sawmill-cut',
      'cement-kiln',
      'module-assembly',
    ]);
    expect(INITIAL_FACILITY_DEFINITIONS.map((item) => item.id)).toEqual([
      'managed-forest',
      'sawmill',
      'quarry',
      'cement-works',
      'port-interchange',
      'prefabrication-plant',
      'town-construction-market',
    ]);
  });

  it('is a valid self-contained economy catalogue', () => {
    expect(validateEconomyContent(
      INITIAL_PRODUCTS,
      INITIAL_RECIPES,
      INITIAL_FACILITY_DEFINITIONS,
    )).toEqual({ valid: true });
  });

  it('uses boundary operations only at the port and town', () => {
    expect(INITIAL_FACILITY_DEFINITIONS.map(({ id, boundary }) => ({
      id,
      boundary,
    }))).toEqual([
      { id: 'managed-forest', boundary: 'none' },
      { id: 'sawmill', boundary: 'none' },
      { id: 'quarry', boundary: 'none' },
      { id: 'cement-works', boundary: 'none' },
      { id: 'port-interchange', boundary: 'port' },
      { id: 'prefabrication-plant', boundary: 'none' },
      { id: 'town-construction-market', boundary: 'town-consumer' },
    ]);
  });
});

describe('validateEconomyContent', () => {
  it.each([
    ['product', () => {
      const products = cloneProducts();
      products.push({ ...products[0] });
      return validateClones(products);
    }],
    ['recipe', () => {
      const recipes = cloneRecipes();
      recipes.push({
        ...recipes[0],
        inputs: [...recipes[0].inputs],
        outputs: [...recipes[0].outputs],
      });
      return validateClones(undefined, recipes);
    }],
    ['facility', () => {
      const facilities = cloneFacilities();
      facilities.push({
        ...facilities[0],
        recipeIds: [...facilities[0].recipeIds],
        inventory: facilities[0].inventory.map((slot) => ({ ...slot })),
      });
      return validateClones(undefined, undefined, facilities);
    }],
  ])('rejects a duplicate %s ID', (_kind, makeResult) => {
    const expectedByKind = {
      product: { valid: false, code: 'duplicate-product', referenceId: 'logs' },
      recipe: {
        valid: false,
        code: 'duplicate-recipe',
        referenceId: 'forest-harvest',
      },
      facility: {
        valid: false,
        code: 'duplicate-facility',
        referenceId: 'managed-forest',
      },
    };
    expect(makeResult()).toEqual(expectedByKind[_kind]);
  });

  it.each(['inputs', 'outputs'] as const)(
    'rejects unknown product references in recipe %s',
    (collection) => {
      const recipes = cloneRecipes();
      const recipe = recipes.find((item) => item.id === 'sawmill-cut');
      recipe[collection] = [
        ...recipe[collection],
        { productId: 'unknown-product', quantity: 1 },
      ];

      expect(validateClones(undefined, recipes)).toEqual({
        valid: false,
        code: 'unknown-recipe-product',
        referenceId: 'unknown-product',
      });
    },
  );

  it('rejects an unknown recipe referenced by a facility', () => {
    const facilities = cloneFacilities();
    facilities[0].recipeIds.push('unknown-recipe');

    expect(validateClones(undefined, undefined, facilities)).toEqual({
      valid: false,
      code: 'unknown-facility-recipe',
      referenceId: 'unknown-recipe',
    });
  });

  it('rejects an unknown product referenced by a facility inventory', () => {
    const facilities = cloneFacilities();
    facilities[0].inventory.push({
      productId: 'unknown-product',
      capacity: 10,
      targetStock: 5,
      initialQuantity: 0,
    });

    expect(validateClones(undefined, undefined, facilities)).toEqual({
      valid: false,
      code: 'unknown-inventory-product',
      referenceId: 'unknown-product',
    });
  });

  it('rejects duplicate inventory slots', () => {
    const facilities = cloneFacilities();
    facilities[0].inventory.push({ ...facilities[0].inventory[0] });

    expect(validateClones(undefined, undefined, facilities)).toEqual({
      valid: false,
      code: 'duplicate-inventory-slot',
      referenceId: 'logs',
    });
  });

  it.each([
    ['zero product mass', (products: MutableProductDefinition[]) => {
      products[0].unitMassKg = 0;
    }],
    ['unsafe product price', (products: MutableProductDefinition[]) => {
      products[0].basePrice = Number.MAX_SAFE_INTEGER + 1;
    }],
  ])('rejects %s', (_description, mutate) => {
    const products = cloneProducts();
    mutate(products);

    expect(validateClones(products)).toEqual({
      valid: false,
      code: 'invalid-product-quantity',
      referenceId: 'logs',
    });
  });

  it.each([
    ['zero recipe amount', (recipe: MutableRecipeDefinition) => {
      recipe.outputs[0].quantity = 0;
    }],
    ['fractional recipe amount', (recipe: MutableRecipeDefinition) => {
      recipe.outputs[0].quantity = 1.5;
    }],
    ['unsafe recipe amount', (recipe: MutableRecipeDefinition) => {
      recipe.outputs[0].quantity = Number.MAX_SAFE_INTEGER + 1;
    }],
  ])('rejects %s', (_description, mutate) => {
    const recipes = cloneRecipes();
    mutate(recipes[0]);

    expect(validateClones(undefined, recipes)).toEqual({
      valid: false,
      code: 'invalid-recipe-quantity',
      referenceId: 'logs',
    });
  });

  it.each([
    ['zero capacity', (slot: MutableInventoryTemplate) => {
      slot.capacity = 0;
    }],
    ['zero target stock', (slot: MutableInventoryTemplate) => {
      slot.targetStock = 0;
    }],
    ['negative initial stock', (slot: MutableInventoryTemplate) => {
      slot.initialQuantity = -1;
    }],
    ['stock over capacity', (slot: MutableInventoryTemplate) => {
      slot.initialQuantity = slot.capacity + 1;
    }],
    ['target over capacity', (slot: MutableInventoryTemplate) => {
      slot.targetStock = slot.capacity + 1;
    }],
    ['unsafe capacity', (slot: MutableInventoryTemplate) => {
      slot.capacity = Number.MAX_SAFE_INTEGER + 1;
    }],
  ])('rejects inventory with %s', (_description, mutate) => {
    const facilities = cloneFacilities();
    mutate(facilities[0].inventory[0]);

    expect(validateClones(undefined, undefined, facilities)).toEqual({
      valid: false,
      code: 'invalid-inventory-quantity',
      referenceId: 'logs',
    });
  });

  it('rejects invalid cargo classes from untyped content', () => {
    const products = cloneProducts();
    (products[0] as any).cargoClass = 'tank';

    expect(validateClones(products)).toEqual({
      valid: false,
      code: 'invalid-cargo-class',
      referenceId: 'logs',
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects an invalid recipe cycle length of %s',
    (cycleTicks) => {
      const recipes = cloneRecipes();
      recipes[0].cycleTicks = cycleTicks;

      expect(validateClones(undefined, recipes)).toEqual({
        valid: false,
        code: 'invalid-recipe-cycle',
        referenceId: 'forest-harvest',
      });
    },
  );

  it('rejects a processing recipe without inputs', () => {
    const recipes = cloneRecipes();
    recipes.find((item) => item.id === 'sawmill-cut').inputs = [];

    expect(validateClones(undefined, recipes)).toEqual({
      valid: false,
      code: 'processing-inputs-required',
      referenceId: 'sawmill-cut',
    });
  });

  it('rejects a recipe without outputs', () => {
    const recipes = cloneRecipes();
    recipes[0].outputs = [];

    expect(validateClones(undefined, recipes)).toEqual({
      valid: false,
      code: 'recipe-outputs-required',
      referenceId: 'forest-harvest',
    });
  });

  it.each([
    {
      name: 'products collection',
      products: null,
      recipes: INITIAL_RECIPES,
      facilities: INITIAL_FACILITY_DEFINITIONS,
      code: 'invalid-products',
    },
    {
      name: 'recipes collection',
      products: INITIAL_PRODUCTS,
      recipes: null,
      facilities: INITIAL_FACILITY_DEFINITIONS,
      code: 'invalid-recipes',
    },
    {
      name: 'facilities collection',
      products: INITIAL_PRODUCTS,
      recipes: INITIAL_RECIPES,
      facilities: null,
      code: 'invalid-facilities',
    },
  ])('returns a stable diagnostic for a malformed $name', ({
    products,
    recipes,
    facilities,
    code,
  }) => {
    expect(validateEconomyContent(
      products as any,
      recipes as any,
      facilities as any,
    )).toEqual({ valid: false, code });
  });

  it.each([
    {
      name: 'product element',
      makeInput: () => ({
        products: [...cloneProducts(), null],
        recipes: cloneRecipes(),
        facilities: cloneFacilities(),
      }),
      expected: { valid: false, code: 'invalid-product' },
    },
    {
      name: 'recipe element',
      makeInput: () => ({
        products: cloneProducts(),
        recipes: [...cloneRecipes(), null],
        facilities: cloneFacilities(),
      }),
      expected: { valid: false, code: 'invalid-recipe' },
    },
    {
      name: 'recipe amount',
      makeInput: () => {
        const recipes = cloneRecipes();
        (recipes[0].outputs as any).push(null);
        return {
          products: cloneProducts(),
          recipes,
          facilities: cloneFacilities(),
        };
      },
      expected: { valid: false, code: 'invalid-recipe-amount' },
    },
    {
      name: 'facility element',
      makeInput: () => ({
        products: cloneProducts(),
        recipes: cloneRecipes(),
        facilities: [...cloneFacilities(), null],
      }),
      expected: { valid: false, code: 'invalid-facility' },
    },
    {
      name: 'inventory slot',
      makeInput: () => {
        const facilities = cloneFacilities();
        (facilities[0].inventory as any).push(null);
        return {
          products: cloneProducts(),
          recipes: cloneRecipes(),
          facilities,
        };
      },
      expected: { valid: false, code: 'invalid-inventory-slot' },
    },
  ])('never throws for a malformed $name', ({ makeInput, expected }) => {
    const input = makeInput();
    expect(validateEconomyContent(
      input.products as any,
      input.recipes as any,
      input.facilities as any,
    )).toEqual(expected);
  });
});

describe('catalogue lookups', () => {
  it('returns definitions by stable ID and undefined for unknown IDs', () => {
    expect(getProduct('cement')?.displayName).toBe('Cement');
    expect(getRecipe('cement-kiln')?.kind).toBe('processing');
    expect(getFacilityDefinition('cement-works')?.displayName)
      .toBe('Cement Works');

    expect(getProduct('unknown')).toBeUndefined();
    expect(getRecipe('unknown')).toBeUndefined();
    expect(getFacilityDefinition('unknown')).toBeUndefined();
  });

  it('does not expose mutable shared definitions or nested arrays', () => {
    const product = getProduct('logs');
    const recipe = getRecipe('sawmill-cut');
    const facility = getFacilityDefinition('sawmill');

    expect(Object.isFrozen(product)).toBe(true);
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(Object.isFrozen(recipe.inputs)).toBe(true);
    expect(Object.isFrozen(recipe.inputs[0])).toBe(true);
    expect(Object.isFrozen(facility)).toBe(true);
    expect(Object.isFrozen(facility.recipeIds)).toBe(true);
    expect(Object.isFrozen(facility.inventory)).toBe(true);
    expect(Object.isFrozen(facility.inventory[0])).toBe(true);

    expect(() => {
      (recipe.outputs as unknown as ProductAmount[]).push({
        productId: 'logs',
        quantity: 1,
      });
    }).toThrow(TypeError);
    expect(getRecipe('sawmill-cut').outputs).toEqual([
      { productId: 'structural-timber', quantity: 8 },
    ]);
  });
});
