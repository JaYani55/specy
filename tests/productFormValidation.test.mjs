import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductFormSchema } from '../src/components/products/types.ts';

test('fixed-price products can be saved without choosing an optional menu color', () => {
  const result = ProductFormSchema.safeParse({
    name: 'Workshop',
    description_de: 'Ein Workshop',
    description_effort: '',
    icon_name: 'balloon',
    assigned_groups: [],
    salary_type: 'Fixpreis',
    salary: 125.5,
    min_amount_mentors: 1,
    approved: [],
    is_mentor_product: false,
  });

  assert.equal(result.success, true);
});
