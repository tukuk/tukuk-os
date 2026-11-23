'use strict';
// ── TUKUK-OS NUTRITION (/nutrition) — Food & Calories Reference, WORLD ────────
// STATIC embedded data — no runtime API call, so a page can never 503 and never
// depends on an upstream. Every figure is an approximate REFERENCE value per 100 g
// derived from public-domain food-composition tables (USDA FoodData Central and
// equivalent national databases) for the raw/plain form of the food. Values are
// rounded to the precision a home cook can act on; they vary with cultivar, ripeness,
// cut and cooking method, and the pages say so. Nutrition facts themselves are
// objective data (not copyrightable); the wording on each page is our own.
// English/global by design; a food is the single most-searched topic on the planet.

function slugify(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Per 100 g: kcal, protein g, carbohydrate g (of which total sugars), total fat g,
// dietary fibre g. `serve` is a typical single portion in grams and `serveLabel` the
// plain-English name for it, so the page can show "one medium banana (118 g)".
// cat = display category. Emoji + blurb are our own editorial text.
const FOODS_RAW = [
  // ── Fruits ──────────────────────────────────────────────────────────────────
  { name: 'Apple', cat: 'Fruits', kcal: 52, protein: 0.3, carbs: 13.8, sugar: 10.4, fat: 0.2, fiber: 2.4, serve: 182, serveLabel: 'one medium apple' },
  { name: 'Banana', cat: 'Fruits', kcal: 89, protein: 1.1, carbs: 22.8, sugar: 12.2, fat: 0.3, fiber: 2.6, serve: 118, serveLabel: 'one medium banana' },
  { name: 'Orange', cat: 'Fruits', kcal: 47, protein: 0.9, carbs: 11.8, sugar: 9.4, fat: 0.1, fiber: 2.4, serve: 131, serveLabel: 'one medium orange' },
  { name: 'Mango', cat: 'Fruits', kcal: 60, protein: 0.8, carbs: 15.0, sugar: 13.7, fat: 0.4, fiber: 1.6, serve: 165, serveLabel: 'one cup, sliced' },
  { name: 'Grapes', cat: 'Fruits', kcal: 69, protein: 0.7, carbs: 18.1, sugar: 15.5, fat: 0.2, fiber: 0.9, serve: 151, serveLabel: 'one cup' },
  { name: 'Watermelon', cat: 'Fruits', kcal: 30, protein: 0.6, carbs: 7.6, sugar: 6.2, fat: 0.2, fiber: 0.4, serve: 152, serveLabel: 'one cup, cubed' },
  { name: 'Strawberries', cat: 'Fruits', kcal: 32, protein: 0.7, carbs: 7.7, sugar: 4.9, fat: 0.3, fiber: 2.0, serve: 144, serveLabel: 'one cup, halves' },
  { name: 'Pineapple', cat: 'Fruits', kcal: 50, protein: 0.5, carbs: 13.1, sugar: 9.9, fat: 0.1, fiber: 1.4, serve: 165, serveLabel: 'one cup, chunks' },
  { name: 'Avocado', cat: 'Fruits', kcal: 160, protein: 2.0, carbs: 8.5, sugar: 0.7, fat: 14.7, fiber: 6.7, serve: 100, serveLabel: 'about half a fruit' },
  { name: 'Blueberries', cat: 'Fruits', kcal: 57, protein: 0.7, carbs: 14.5, sugar: 10.0, fat: 0.3, fiber: 2.4, serve: 148, serveLabel: 'one cup' },
  { name: 'Papaya', cat: 'Fruits', kcal: 43, protein: 0.5, carbs: 10.8, sugar: 7.8, fat: 0.3, fiber: 1.7, serve: 145, serveLabel: 'one cup, cubes' },
  { name: 'Kiwi', cat: 'Fruits', kcal: 61, protein: 1.1, carbs: 14.7, sugar: 9.0, fat: 0.5, fiber: 3.0, serve: 69, serveLabel: 'one medium kiwi' },
  { name: 'Lemon', cat: 'Fruits', kcal: 29, protein: 1.1, carbs: 9.3, sugar: 2.5, fat: 0.3, fiber: 2.8, serve: 58, serveLabel: 'one lemon, peeled' },
  { name: 'Peach', cat: 'Fruits', kcal: 39, protein: 0.9, carbs: 9.5, sugar: 8.4, fat: 0.3, fiber: 1.5, serve: 150, serveLabel: 'one medium peach' },
  { name: 'Pear', cat: 'Fruits', kcal: 57, protein: 0.4, carbs: 15.2, sugar: 9.8, fat: 0.1, fiber: 3.1, serve: 178, serveLabel: 'one medium pear' },
  { name: 'Tomato', cat: 'Fruits', kcal: 18, protein: 0.9, carbs: 3.9, sugar: 2.6, fat: 0.2, fiber: 1.2, serve: 123, serveLabel: 'one medium tomato' },

  // ── Vegetables ──────────────────────────────────────────────────────────────
  { name: 'Potato', cat: 'Vegetables', kcal: 93, protein: 2.5, carbs: 21.1, sugar: 0.9, fat: 0.2, fiber: 2.7, serve: 173, serveLabel: 'one baked potato' },
  { name: 'Sweet Potato', cat: 'Vegetables', kcal: 86, protein: 1.6, carbs: 20.1, sugar: 4.2, fat: 0.1, fiber: 3.0, serve: 130, serveLabel: 'one baked sweet potato' },
  { name: 'Carrot', cat: 'Vegetables', kcal: 41, protein: 0.9, carbs: 9.6, sugar: 4.7, fat: 0.2, fiber: 2.8, serve: 61, serveLabel: 'one medium carrot' },
  { name: 'Broccoli', cat: 'Vegetables', kcal: 34, protein: 2.8, carbs: 6.6, sugar: 1.7, fat: 0.4, fiber: 2.6, serve: 91, serveLabel: 'one cup, chopped' },
  { name: 'Spinach', cat: 'Vegetables', kcal: 23, protein: 2.9, carbs: 3.6, sugar: 0.4, fat: 0.4, fiber: 2.2, serve: 30, serveLabel: 'one cup, raw leaves' },
  { name: 'Cucumber', cat: 'Vegetables', kcal: 15, protein: 0.7, carbs: 3.6, sugar: 1.7, fat: 0.1, fiber: 0.5, serve: 104, serveLabel: 'one half cucumber' },
  { name: 'Onion', cat: 'Vegetables', kcal: 40, protein: 1.1, carbs: 9.3, sugar: 4.2, fat: 0.1, fiber: 1.7, serve: 110, serveLabel: 'one medium onion' },
  { name: 'Bell Pepper', cat: 'Vegetables', kcal: 31, protein: 1.0, carbs: 6.0, sugar: 4.9, fat: 0.4, fiber: 2.1, serve: 119, serveLabel: 'one medium pepper' },
  { name: 'Cabbage', cat: 'Vegetables', kcal: 25, protein: 1.3, carbs: 5.8, sugar: 4.0, fat: 0.1, fiber: 2.5, serve: 89, serveLabel: 'one cup, shredded' },
  { name: 'Lettuce', cat: 'Vegetables', kcal: 15, protein: 1.4, carbs: 2.9, sugar: 2.0, fat: 0.2, fiber: 1.3, serve: 47, serveLabel: 'one cup, shredded' },
  { name: 'Cauliflower', cat: 'Vegetables', kcal: 25, protein: 1.9, carbs: 5.0, sugar: 1.9, fat: 0.3, fiber: 2.0, serve: 100, serveLabel: 'one cup, florets' },
  { name: 'Zucchini', cat: 'Vegetables', kcal: 17, protein: 1.2, carbs: 3.1, sugar: 2.5, fat: 0.3, fiber: 1.0, serve: 124, serveLabel: 'one cup, sliced' },
  { name: 'Garlic', cat: 'Vegetables', kcal: 149, protein: 6.4, carbs: 33.1, sugar: 1.0, fat: 0.5, fiber: 2.1, serve: 3, serveLabel: 'one clove' },
  { name: 'Green Peas', cat: 'Vegetables', kcal: 81, protein: 5.4, carbs: 14.5, sugar: 5.7, fat: 0.4, fiber: 5.7, serve: 160, serveLabel: 'one cup, cooked' },
  { name: 'Sweet Corn', cat: 'Vegetables', kcal: 86, protein: 3.3, carbs: 18.7, sugar: 6.3, fat: 1.4, fiber: 2.0, serve: 154, serveLabel: 'one ear, kernels' },

  // ── Grains & Bread ──────────────────────────────────────────────────────────
  { name: 'White Rice', cat: 'Grains & Bread', kcal: 130, protein: 2.7, carbs: 28.2, sugar: 0.1, fat: 0.3, fiber: 0.4, serve: 158, serveLabel: 'one cup, cooked' },
  { name: 'Brown Rice', cat: 'Grains & Bread', kcal: 112, protein: 2.3, carbs: 23.5, sugar: 0.4, fat: 1.0, fiber: 1.8, serve: 195, serveLabel: 'one cup, cooked' },
  { name: 'Whole-Wheat Bread', cat: 'Grains & Bread', kcal: 247, protein: 13.0, carbs: 41.0, sugar: 6.0, fat: 3.4, fiber: 7.0, serve: 43, serveLabel: 'two slices' },
  { name: 'White Bread', cat: 'Grains & Bread', kcal: 265, protein: 9.4, carbs: 49.0, sugar: 5.0, fat: 3.2, fiber: 2.7, serve: 50, serveLabel: 'two slices' },
  { name: 'Pasta', cat: 'Grains & Bread', kcal: 131, protein: 5.0, carbs: 25.0, sugar: 0.6, fat: 1.1, fiber: 1.8, serve: 140, serveLabel: 'one cup, cooked' },
  { name: 'Rolled Oats', cat: 'Grains & Bread', kcal: 389, protein: 16.9, carbs: 66.3, sugar: 1.0, fat: 6.9, fiber: 10.6, serve: 40, serveLabel: 'one serving, dry' },
  { name: 'Quinoa', cat: 'Grains & Bread', kcal: 120, protein: 4.4, carbs: 21.3, sugar: 0.9, fat: 1.9, fiber: 2.8, serve: 185, serveLabel: 'one cup, cooked' },
  { name: 'Couscous', cat: 'Grains & Bread', kcal: 112, protein: 3.8, carbs: 23.2, sugar: 0.2, fat: 0.2, fiber: 1.4, serve: 157, serveLabel: 'one cup, cooked' },
  { name: 'Barley', cat: 'Grains & Bread', kcal: 123, protein: 2.3, carbs: 28.2, sugar: 0.3, fat: 0.4, fiber: 2.8, serve: 157, serveLabel: 'one cup, cooked' },
  { name: 'Corn Tortilla', cat: 'Grains & Bread', kcal: 218, protein: 5.7, carbs: 44.6, sugar: 0.9, fat: 6.1, fiber: 5.3, serve: 24, serveLabel: 'one small tortilla' },
  { name: 'Bagel', cat: 'Grains & Bread', kcal: 250, protein: 10.0, carbs: 48.0, sugar: 5.5, fat: 1.5, fiber: 2.1, serve: 98, serveLabel: 'one plain bagel' },

  // ── Protein (meat, fish, eggs, legumes) ─────────────────────────────────────
  { name: 'Chicken Breast', cat: 'Protein', kcal: 165, protein: 31.0, carbs: 0.0, sugar: 0.0, fat: 3.6, fiber: 0.0, serve: 172, serveLabel: 'one roasted breast' },
  { name: 'Egg', cat: 'Protein', kcal: 155, protein: 13.0, carbs: 1.1, sugar: 1.1, fat: 11.0, fiber: 0.0, serve: 50, serveLabel: 'one large egg' },
  { name: 'Beef (ground, cooked)', cat: 'Protein', kcal: 250, protein: 26.0, carbs: 0.0, sugar: 0.0, fat: 15.0, fiber: 0.0, serve: 113, serveLabel: 'one small patty' },
  { name: 'Salmon', cat: 'Protein', kcal: 206, protein: 22.1, carbs: 0.0, sugar: 0.0, fat: 12.1, fiber: 0.0, serve: 154, serveLabel: 'one fillet' },
  { name: 'Tuna (canned in water)', cat: 'Protein', kcal: 116, protein: 25.0, carbs: 0.0, sugar: 0.0, fat: 1.0, fiber: 0.0, serve: 142, serveLabel: 'one can, drained' },
  { name: 'Shrimp', cat: 'Protein', kcal: 99, protein: 24.0, carbs: 0.2, sugar: 0.0, fat: 0.3, fiber: 0.0, serve: 85, serveLabel: 'one serving' },
  { name: 'Pork Chop', cat: 'Protein', kcal: 231, protein: 25.7, carbs: 0.0, sugar: 0.0, fat: 14.0, fiber: 0.0, serve: 110, serveLabel: 'one chop, cooked' },
  { name: 'Lamb', cat: 'Protein', kcal: 258, protein: 25.6, carbs: 0.0, sugar: 0.0, fat: 17.0, fiber: 0.0, serve: 85, serveLabel: 'one chop, cooked' },
  { name: 'Turkey Breast', cat: 'Protein', kcal: 135, protein: 29.0, carbs: 0.0, sugar: 0.0, fat: 1.0, fiber: 0.0, serve: 85, serveLabel: 'one serving, roasted' },
  { name: 'Cod', cat: 'Protein', kcal: 105, protein: 23.0, carbs: 0.0, sugar: 0.0, fat: 0.9, fiber: 0.0, serve: 125, serveLabel: 'one fillet, cooked' },
  { name: 'Sardines (canned)', cat: 'Protein', kcal: 208, protein: 24.6, carbs: 0.0, sugar: 0.0, fat: 11.4, fiber: 0.0, serve: 100, serveLabel: 'one tin, drained' },
  { name: 'Tofu (firm)', cat: 'Protein', kcal: 144, protein: 17.3, carbs: 2.8, sugar: 0.6, fat: 8.7, fiber: 2.3, serve: 126, serveLabel: 'one serving' },
  { name: 'Lentils', cat: 'Protein', kcal: 116, protein: 9.0, carbs: 20.1, sugar: 1.8, fat: 0.4, fiber: 7.9, serve: 198, serveLabel: 'one cup, cooked' },
  { name: 'Chickpeas', cat: 'Protein', kcal: 164, protein: 8.9, carbs: 27.4, sugar: 4.8, fat: 2.6, fiber: 7.6, serve: 164, serveLabel: 'one cup, cooked' },
  { name: 'Black Beans', cat: 'Protein', kcal: 87, protein: 7.6, carbs: 15.7, sugar: 0.3, fat: 0.3, fiber: 5.4, serve: 172, serveLabel: 'one cup, cooked' },

  // ── Dairy & Eggs ────────────────────────────────────────────────────────────
  { name: 'Milk (whole)', cat: 'Dairy', kcal: 61, protein: 3.3, carbs: 4.8, sugar: 4.8, fat: 3.3, fiber: 0.0, serve: 244, serveLabel: 'one cup' },
  { name: 'Milk (skim)', cat: 'Dairy', kcal: 34, protein: 3.4, carbs: 4.9, sugar: 4.9, fat: 0.1, fiber: 0.0, serve: 245, serveLabel: 'one cup' },
  { name: 'Cheddar Cheese', cat: 'Dairy', kcal: 403, protein: 25.0, carbs: 3.4, sugar: 0.5, fat: 33.0, fiber: 0.0, serve: 28, serveLabel: 'one slice' },
  { name: 'Mozzarella', cat: 'Dairy', kcal: 300, protein: 22.0, carbs: 2.2, sugar: 1.0, fat: 22.0, fiber: 0.0, serve: 28, serveLabel: 'one slice' },
  { name: 'Greek Yogurt (nonfat)', cat: 'Dairy', kcal: 59, protein: 10.2, carbs: 3.6, sugar: 3.2, fat: 0.4, fiber: 0.0, serve: 170, serveLabel: 'one container' },
  { name: 'Yogurt (plain, whole)', cat: 'Dairy', kcal: 61, protein: 3.5, carbs: 4.7, sugar: 4.7, fat: 3.3, fiber: 0.0, serve: 245, serveLabel: 'one cup' },
  { name: 'Butter', cat: 'Dairy', kcal: 717, protein: 0.9, carbs: 0.1, sugar: 0.1, fat: 81.0, fiber: 0.0, serve: 14, serveLabel: 'one tablespoon' },
  { name: 'Cream Cheese', cat: 'Dairy', kcal: 342, protein: 6.2, carbs: 5.5, sugar: 3.8, fat: 34.0, fiber: 0.0, serve: 28, serveLabel: 'two tablespoons' },
  { name: 'Ice Cream (vanilla)', cat: 'Dairy', kcal: 207, protein: 3.5, carbs: 23.6, sugar: 21.1, fat: 11.0, fiber: 0.7, serve: 66, serveLabel: 'one small scoop' },

  // ── Nuts & Seeds ────────────────────────────────────────────────────────────
  { name: 'Almonds', cat: 'Nuts & Seeds', kcal: 579, protein: 21.2, carbs: 21.6, sugar: 4.4, fat: 49.9, fiber: 12.5, serve: 28, serveLabel: 'one ounce, ~23 nuts' },
  { name: 'Peanuts', cat: 'Nuts & Seeds', kcal: 567, protein: 25.8, carbs: 16.1, sugar: 4.7, fat: 49.2, fiber: 8.5, serve: 28, serveLabel: 'one ounce' },
  { name: 'Walnuts', cat: 'Nuts & Seeds', kcal: 654, protein: 15.2, carbs: 13.7, sugar: 2.6, fat: 65.2, fiber: 6.7, serve: 28, serveLabel: 'one ounce, ~14 halves' },
  { name: 'Cashews', cat: 'Nuts & Seeds', kcal: 553, protein: 18.2, carbs: 30.2, sugar: 5.9, fat: 43.8, fiber: 3.3, serve: 28, serveLabel: 'one ounce, ~18 nuts' },
  { name: 'Pistachios', cat: 'Nuts & Seeds', kcal: 560, protein: 20.2, carbs: 27.2, sugar: 7.8, fat: 45.3, fiber: 10.3, serve: 28, serveLabel: 'one ounce, shelled' },
  { name: 'Sunflower Seeds', cat: 'Nuts & Seeds', kcal: 584, protein: 20.8, carbs: 20.0, sugar: 2.6, fat: 51.5, fiber: 8.6, serve: 16, serveLabel: 'quarter cup, shelled' },
  { name: 'Chia Seeds', cat: 'Nuts & Seeds', kcal: 486, protein: 16.5, carbs: 42.1, sugar: 0.0, fat: 30.7, fiber: 34.4, serve: 28, serveLabel: 'two tablespoons' },
  { name: 'Flaxseed', cat: 'Nuts & Seeds', kcal: 534, protein: 18.3, carbs: 28.9, sugar: 0.0, fat: 42.2, fiber: 27.3, serve: 7, serveLabel: 'one tablespoon, ground' },
  { name: 'Hazelnuts', cat: 'Nuts & Seeds', kcal: 628, protein: 15.0, carbs: 16.7, sugar: 4.3, fat: 60.8, fiber: 9.7, serve: 21, serveLabel: 'one ounce, ~21 nuts' },
  { name: 'Coconut (dried, unsweetened)', cat: 'Nuts & Seeds', kcal: 660, protein: 3.3, carbs: 64.5, sugar: 22.0, fat: 64.5, fiber: 16.3, serve: 80, serveLabel: 'one cup, shredded' },

  // ── Fats & Oils ─────────────────────────────────────────────────────────────
  { name: 'Olive Oil', cat: 'Fats & Oils', kcal: 884, protein: 0.0, carbs: 0.0, sugar: 0.0, fat: 100.0, fiber: 0.0, serve: 14, serveLabel: 'one tablespoon' },
  { name: 'Coconut Oil', cat: 'Fats & Oils', kcal: 862, protein: 0.0, carbs: 0.0, sugar: 0.0, fat: 100.0, fiber: 0.0, serve: 14, serveLabel: 'one tablespoon' },
  { name: 'Canola Oil', cat: 'Fats & Oils', kcal: 884, protein: 0.0, carbs: 0.0, sugar: 0.0, fat: 100.0, fiber: 0.0, serve: 14, serveLabel: 'one tablespoon' },

  // ── Snacks & Sweets ─────────────────────────────────────────────────────────
  { name: 'Dark Chocolate (70-85%)', cat: 'Snacks & Sweets', kcal: 598, protein: 7.8, carbs: 45.9, sugar: 24.0, fat: 42.6, fiber: 10.9, serve: 28, serveLabel: 'one ounce' },
  { name: 'Milk Chocolate', cat: 'Snacks & Sweets', kcal: 535, protein: 7.7, carbs: 59.4, sugar: 51.9, fat: 29.7, fiber: 3.4, serve: 40, serveLabel: 'one bar piece' },
  { name: 'Honey', cat: 'Snacks & Sweets', kcal: 304, protein: 0.3, carbs: 82.4, sugar: 82.1, fat: 0.0, fiber: 0.2, serve: 21, serveLabel: 'one tablespoon' },
  { name: 'Potato Chips', cat: 'Snacks & Sweets', kcal: 536, protein: 7.0, carbs: 52.9, sugar: 0.5, fat: 34.6, fiber: 4.0, serve: 28, serveLabel: 'one ounce' },
  { name: 'Popcorn (air-popped)', cat: 'Snacks & Sweets', kcal: 387, protein: 12.9, carbs: 77.8, sugar: 0.9, fat: 4.5, fiber: 14.5, serve: 8, serveLabel: 'one cup, popped' },
  { name: 'Chocolate Chip Cookie', cat: 'Snacks & Sweets', kcal: 493, protein: 5.6, carbs: 63.0, sugar: 37.0, fat: 24.0, fiber: 2.0, serve: 16, serveLabel: 'one cookie' },
  { name: 'Chocolate Cake', cat: 'Snacks & Sweets', kcal: 332, protein: 4.5, carbs: 43.0, sugar: 30.0, fat: 16.0, fiber: 2.0, serve: 85, serveLabel: 'one slice' },
  { name: 'Doughnut', cat: 'Snacks & Sweets', kcal: 452, protein: 5.0, carbs: 51.0, sugar: 23.0, fat: 25.0, fiber: 2.0, serve: 60, serveLabel: 'one glazed ring' },
  { name: 'Table Sugar', cat: 'Snacks & Sweets', kcal: 387, protein: 0.0, carbs: 100.0, sugar: 100.0, fat: 0.0, fiber: 0.0, serve: 4, serveLabel: 'one teaspoon' },
  { name: 'Maple Syrup', cat: 'Snacks & Sweets', kcal: 260, protein: 0.0, carbs: 67.0, sugar: 60.0, fat: 0.1, fiber: 0.0, serve: 20, serveLabel: 'one tablespoon' },

  // ── Drinks ──────────────────────────────────────────────────────────────────
  { name: 'Coffee (black, brewed)', cat: 'Drinks', kcal: 2, protein: 0.1, carbs: 0.0, sugar: 0.0, fat: 0.0, fiber: 0.0, serve: 240, serveLabel: 'one cup' },
  { name: 'Green Tea (brewed)', cat: 'Drinks', kcal: 1, protein: 0.0, carbs: 0.2, sugar: 0.0, fat: 0.0, fiber: 0.0, serve: 240, serveLabel: 'one cup' },
  { name: 'Orange Juice', cat: 'Drinks', kcal: 45, protein: 0.7, carbs: 10.4, sugar: 8.4, fat: 0.2, fiber: 0.2, serve: 248, serveLabel: 'one cup' },
  { name: 'Cola (soft drink)', cat: 'Drinks', kcal: 42, protein: 0.0, carbs: 10.6, sugar: 10.6, fat: 0.0, fiber: 0.0, serve: 355, serveLabel: 'one can' },
  { name: 'Beer (regular)', cat: 'Drinks', kcal: 43, protein: 0.5, carbs: 3.6, sugar: 0.0, fat: 0.0, fiber: 0.0, serve: 355, serveLabel: 'one bottle' },
  { name: 'Red Wine', cat: 'Drinks', kcal: 85, protein: 0.1, carbs: 2.6, sugar: 0.6, fat: 0.0, fiber: 0.0, serve: 147, serveLabel: 'one glass' },
  { name: 'Coconut Water', cat: 'Drinks', kcal: 19, protein: 0.7, carbs: 3.7, sugar: 2.6, fat: 0.2, fiber: 1.1, serve: 240, serveLabel: 'one cup' },
];

// Stable id, lookup maps, and category grouping.
const FOODS = FOODS_RAW.map((f) => ({ ...f, slug: slugify(f.name) }));
const F_BY_SLUG = new Map(FOODS.map((f) => [f.slug, f]));

// Categories in a sensible reading order (as authored above), each with its foods.
const CAT_ORDER = [];
for (const f of FOODS) if (!CAT_ORDER.includes(f.cat)) CAT_ORDER.push(f.cat);
const CATEGORIES = CAT_ORDER.map((name) => ({ name, slug: slugify(name), items: FOODS.filter((f) => f.cat === name) }));

function findFood(slug) { return F_BY_SLUG.get(String(slug || '').toLowerCase()) || null; }
function findCategory(slug) { const c = CATEGORIES.find((x) => x.slug === String(slug || '').toLowerCase()); return c || null; }

// Energy split by macro (kcal per gram: protein 4, carbs 4, fat 9) — used to draw the
// contribution bar on each food page. Sums to less than total kcal for high-fibre foods
// (fibre is partly unusable energy), which is honest rather than forcing 100%.
function macroPercents(f) {
  const pk = f.protein * 4, ck = f.carbs * 4, fk = f.fat * 9;
  const t = pk + ck + fk || 1;
  return { protein: Math.round((pk / t) * 100), carbs: Math.round((ck / t) * 100), fat: Math.round((fk / t) * 100) };
}

// One portion (serve grams) scaled from the per-100 g figures.
function perServing(f) {
  const k = f.serve / 100;
  const r = (v) => Math.round(v * k * 10) / 10;
  return { grams: f.serve, kcal: Math.round(f.kcal * k), protein: r(f.protein), carbs: r(f.carbs), sugar: r(f.sugar), fat: r(f.fat), fiber: r(f.fiber) };
}

module.exports = {
  FOODS, CATEGORIES, CAT_ORDER,
  findFood, findCategory, macroPercents, perServing, slugify,
};
