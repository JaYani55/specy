import { ProductInfo } from '@/components/products/types';
import { Product } from '../services/events/productService';

export type EventStatus = 'new' | 'firstRequests' | 'successPartly' | 'successComplete' | 'locked';
export type EventMode = 'live' | 'online' | 'hybrid';

export interface Event {
  id: string;
  title: string;
  company: string;
  company_id?: string;
  date: string;
  time: string;
  end_time?: string;
  duration_minutes?: number;
  teams_link: string;
  description: string;
  staff_members: string[]; // Primary field
  primaryStaffId: string; // Computed: staff_members[0]
  primaryStaffName: string; // Name of primary staff
  staffNames: string[]; // Names of all staff
  staffProfilePicture?: string; // Replace coach_profile with this
  status: EventStatus;
  mode?: EventMode;
  requestingMentors: string[];
  acceptedMentors: string[];
  declinedMentors: string[];
  column?: number;
  amount_requiredmentors: number;
  required_staff_count: number;
  required_trait_id?: number | null;
  product_id?: number;
  initial_selected_mentors?: string[];
  companyInfo?: {
    id: string;
    name: string;
    logo_url?: string;
  };
  ProductInfo?: ProductInfo;
}

export interface EventFormData {
  company_id?: string;
  company: string;
  date: string;
  time: string;
  end_time?: string;
  duration_minutes?: number;
  description: string;
  status: EventStatus;
  mode?: EventMode;
  required_staff_count: number;
  required_trait_id?: number | null;
  product_id?: number;
  staff_members: string[]; // Replace with this
  teams_link: string;
  isLocked: boolean;
}

export interface EventFormErrors {
  company_id?: string;
  staff_members?: string; // Add this instead
  date?: string;
  time?: string;
  teams_link?: string;
  amount_requiredmentors?: string;
  mode?: string;
}
