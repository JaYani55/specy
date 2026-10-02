import { supabase } from '../../lib/supabase';

// Ensure this is explicitly exported as an interface
export interface Product {
  id: number;
  name: string;
  description_effort: string;
  description_de: string;
  created_at?: string;
  updated_at?: string;
  icon_name?: string;
  assigned_groups?: number[];
  salary_type?: 'Standard' | 'Fixpreis' | 'Stundensatz';
  salary?: number;
  min_amount_mentors?: number;
  max_amount_mentors?: number;
  approved?: string[];
  gradient?: string;
  is_mentor_product?: boolean; // Make sure this is included
}

// Type for Supabase query responses
export interface SupabaseResponse<T> {
  data: T | null;
  error: Error | null;
}

export const fetchProducts = async (tenantId?: string | null): Promise<Product[]> => {
  let query = supabase
    .from('mentorbooking_products')
    .select('*')
    .order('name', { ascending: true });
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const response: SupabaseResponse<Product[]> = await query;

  const { data, error } = response;

  if (error) {
    console.error('Error fetching Products:', error);
    return [];
  }

  return data || [];
};

export const fetchProductById = async (id: number, tenantId?: string | null): Promise<Product | null> => {
  if (!id) return null;

  let query = supabase
    .from('mentorbooking_products')
    .select('*')
    .eq('id', id);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query.single();

  if (error) {
    console.error('Error fetching Product:', error);
    return null;
  }

  return data;
};

// Create a new Product
export const createProduct = async (Product: Omit<Product, 'id'>, tenantId?: string | null): Promise<Product | null> => {
  try {
    // Ensure required fields have defaults and proper data types
    // DO NOT include 'id' in the insert data - let the database generate it
    const sanitizedProduct = {
      name: Product.name || 'New Product',
      description_de: Product.description_de || '',
      description_effort: Product.description_effort || '',
      icon_name: Product.icon_name || 'balloon',
      assigned_groups: Array.isArray(Product.assigned_groups) ? Product.assigned_groups : [],
      salary_type: Product.salary_type || null,
      salary: typeof Product.salary === 'number' ? Product.salary : null,
      min_amount_mentors: typeof Product.min_amount_mentors === 'number' ? Product.min_amount_mentors : null,
      max_amount_mentors: typeof Product.max_amount_mentors === 'number' ? Product.max_amount_mentors : null,
      approved: Array.isArray(Product.approved) ? Product.approved : [],
      gradient: Product.gradient || null,
      is_mentor_product: Boolean(Product.is_mentor_product)
      // DO NOT include id, created_at, or updated_at - let the database handle these
    };
    if (tenantId) Object.assign(sanitizedProduct, { tenant_id: tenantId });
    
    console.log('Creating product with sanitized data:', sanitizedProduct);
    
    const { data, error } = await supabase
      .from('mentorbooking_products')
      .insert([sanitizedProduct])
      .select();

    if (error) {
      console.error('Supabase error creating Product:', error);
      throw new Error(`Database error: ${error.message}`);
    }

    if (!data || data.length === 0) {
      throw new Error('No data returned from product creation');
    }

    return data[0];
  } catch (error) {
    console.error('Exception in createProduct:', error);
    throw error;
  }
};

// Update an existing Product
export const updateProduct = async (id: number, Product: Partial<Product>, tenantId?: string | null): Promise<Product | null> => {
  console.log(`Updating product with ID ${id}:`, Product);
  
  try {
    // Format the approved field as array
    const updateData = { ...Product };
    if ('approved' in updateData) {
      updateData.approved = Array.isArray(updateData.approved) ? updateData.approved : [];
    }
    
    // Remove delivery_mode handling since it's no longer part of products
    
    let query = supabase
      .from('mentorbooking_products')
      .update(updateData)
      .eq('id', id);
    if (tenantId) query = query.eq('tenant_id', tenantId);
    const { data, error } = await query.select();

    if (error) {
      console.error('Error updating Product:', error);
      throw new Error(`Failed to update product: ${error.message}`);
    }

    if (!data || data.length === 0) {
      console.error('No data returned after update');
      return null;
    }

    console.log('Product updated successfully:', data[0]);
    return data[0];
  } catch (error) {
    console.error('Exception in updateProduct:', error);
    throw error;
  }
};

// Delete a Product
export const deleteProduct = async (id: number, tenantId?: string | null): Promise<boolean> => {
  if (!tenantId) throw new Error('A workspace is required to delete a product.');
  const { error } = await supabase.rpc('delete_mentorbooking_product_aggregate', {
    target_product_id: id,
    expected_tenant_id: tenantId,
  });
  if (error) {
    // The database performs both deletes in one transaction and refuses to
    // remove products still referenced by active or archived events.
    throw new Error(`Product could not be deleted: ${error.message}`);
  }
  return true;
};

export interface Mentor {
  id: string;
  name: string;
  email?: string; // Make email optional since it might not exist in the table
}

export const fetchMentors = async (): Promise<Mentor[]> => {
  try {
    console.log("Starting mentor fetch process for product approval");
    
    // Step 1: Get the role_id for 'mentor'
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'mentor')
      .single();

    if (roleError) {
      console.error('Error fetching mentor role:', roleError);
      return [];
    }

    if (!roleData) {
      console.warn('No mentor role found in database');
      return [];
    }

    const mentorRoleId = roleData.id;
    console.log(`Found mentor role ID: ${mentorRoleId}`);
    
    // Step 2: Get all users with the mentor role
    const { data: userRolesData, error: userRolesError } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role_id', mentorRoleId);

    if (userRolesError) {
      console.error('Error fetching users with mentor role:', userRolesError);
      return [];
    }

    if (!userRolesData?.length) {
      console.log('No mentors found in user_roles table');
      return [];
    }

    console.log(`Found ${userRolesData.length} users with mentor role`);
    
    // Step 3: Get user profiles for these mentors - ONLY select columns we know exist
    const mentorIds = userRolesData.map(item => item.user_id);
    
    // Use a simpler query with fewer columns - ONLY get user_id and Username
    const { data: userData, error: userError } = await supabase
      .from('user_profile')
      .select('user_id, Username') // REMOVED email which doesn't exist!
      .in('user_id', mentorIds);

    if (userError) {
      console.error('Error fetching mentor profiles:', userError);
      return [];
    }

    if (!userData || userData.length === 0) {
      console.log('No mentor profiles found');
      return [];
    }

    console.log(`Successfully loaded ${userData.length} mentor profiles`);
    
    // Transform the data to match our Mentor interface
    return userData.map(user => ({
      id: user.user_id,
      name: user.Username || 'Unknown',
      // Don't include email since it doesn't exist in the table
    }));
  } catch (error) {
    console.error('Exception in fetchMentors:', error);
    return [];
  }
};

export const ensureProductGradient = (product: Product): Product => {
  if (!product.gradient) {
    const colors = [
      ['#3b82f6', '#93c5fd'], // Blue
      ['#10b981', '#6ee7b7'], // Green
      ['#8b5cf6', '#c4b5fd'], // Purple
      ['#ef4444', '#fca5a5'], // Red
      ['#f97316', '#fdba74'], // Orange
      ['#ec4899', '#f9a8d4']  // Pink
    ];
    let colorPair;
    // Wichtig: Prüfen auf eine gültige ID (> 0), da wir den Dummy mit ID 0 verwenden könnten
    if (typeof product.id === 'number' && !isNaN(product.id) && product.id > 0) {
      colorPair = colors[product.id % colors.length];
    } else {
      colorPair = colors[0]; // Fallback zum ersten Farbpaar, wenn ID ungültig oder 0
    }
    // Erstelle ein NEUES Product-Objekt mit dem Gradienten, um Immutability zu wahren
    return {
      ...product,
      gradient: `linear-gradient(90deg, ${colorPair[0]}, ${colorPair[1]})`
    };
  }
  // Wenn Gradient bereits existiert, gib eine Kopie des Produkts zurück, um Immutability zu wahren.
  return { ...product };
};