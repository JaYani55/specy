import { z } from 'zod';
import type { Product } from '@/services/events/productService';
export type { Product } from '@/services/events/productService';
import type { MentorGroup } from '@/services/mentorGroupService';
import type { Mentor } from '@/services/events/productService';

// Extended interface with traits
export interface ExtendedMentor extends Mentor {
  traits?: string[];
}

// Response interface for trait members
export interface MentorGroupMemberResponse {
  group_id: number;
  mentorbooking_mentor_groups: {
    group_name: string;
  } | {
    group_name: string;
  }[] | null;
}

// Schema for form validation
export const ProductFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description_de: z.string().optional(),
  description_effort: z.string().optional(),
  icon_name: z.string().min(1, "Icon is required"),
  assigned_groups: z.array(z.number()).default([]),
  salary_type: z.enum(['Standard', 'Fixpreis', 'Stundensatz']).optional(),
  salary: z.number().optional(),
  min_amount_mentors: z.number().optional(),
  max_amount_mentors: z.number().optional(),
  approved: z.array(z.string()).default([]),
  gradient: z.string().optional(),
  is_mentor_product: z.boolean().default(false),
  custom_fields: z.record(z.string(), z.unknown()).default({}),
});

export type ProductFormValues = z.infer<typeof ProductFormSchema>;

export interface ProductFormProps {
  editingProduct: Product | null;
  isLoading: boolean;
  onSubmit: (values: ProductFormValues) => Promise<void>;
  onCancel: () => void;
  getUsedIcons: () => (string | null | undefined)[];
  embedded?: boolean; // Add this
}

export interface ProductInfo {
  id: number;
  name: string;
  icon_name?: string;
  gradient?: string;
  description_de?: string;
  description_effort?: string;
  assigned_groups?: number[];
  salary_type?: Product['salary_type'];
  salary?: number;
  min_amount_mentors?: number;
  max_amount_mentors?: number;
  approved?: string[];
  is_mentor_product?: boolean;
}