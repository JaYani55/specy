import React, { useState, useEffect } from 'react';
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { useTheme } from '@/contexts/ThemeContext';

// Fix the imports to point to the correct locations
import { 
  ProductFormValues,
  ProductFormSchema,
  ProductFormProps
} from '@/components/products/types';
import { useMentorGroupsAndMentors } from '@/hooks/useMentorGroupsAndMentors';
import {
  ProductFormHeader,
  ProductFormBasicInfo,
  ProductFormDelivery,
  ProductFormCompensation,
  ProductFormMentorRequirements,
  ProductFormApprovedMentors,
  ProductFormGradient,
  ProductFormFooter,
} from '@/components/products';
import { ProductFormMentorToggle } from '@/components/products/form/ProductFormMentorToggle';

export function ProductForm({ 
  editingProduct, 
  isLoading: formIsLoading, 
  onSubmit, 
  onCancel, 
  getUsedIcons 
}: ProductFormProps) {
  const { language } = useTheme();
  const [formKey, setFormKey] = useState(Date.now());
  
  // Use our custom hook to load form data
  const { 
    mentorGroups, 
    mentors, 
    loadingGroups, 
    loadingMentors 
  } = useMentorGroupsAndMentors();
  
  // Create form with default empty values
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(ProductFormSchema),
    defaultValues: {
      name: '',
      description_effort: '',
      description_de: '',
      icon_name: 'balloon',
      assigned_groups: [],
      salary_type: undefined,
      salary: undefined,
      min_amount_mentors: undefined,
      max_amount_mentors: undefined,
      approved: [],
      is_mentor_product: false,
    }
  });

  // Watch the is_mentor_product field to conditionally show mentor-related fields
  const isMentorProduct = form.watch('is_mentor_product');

  // Form initialization from editingProduct
  useEffect(() => {
    if (!editingProduct) {
      return;
    }

    // Create a complete form values object with better null handling
    const formValues: ProductFormValues = {
      name: editingProduct.name || '',
      description_effort: editingProduct.description_effort || '',
      description_de: editingProduct.description_de || '',
      icon_name: editingProduct.icon_name || 'balloon',
      assigned_groups: Array.isArray(editingProduct.assigned_groups) ? editingProduct.assigned_groups : [],
      salary_type: editingProduct.salary_type || undefined,
      salary: editingProduct.salary === null ? undefined : editingProduct.salary,
      min_amount_mentors: editingProduct.min_amount_mentors || undefined,
      max_amount_mentors: editingProduct.max_amount_mentors === null ? undefined : editingProduct.max_amount_mentors,
      approved: Array.isArray(editingProduct.approved) ? editingProduct.approved : [],
      gradient: editingProduct.gradient || '',
      is_mentor_product: editingProduct.is_mentor_product || false,
    };
    
    // Reset the form with the complete object
    form.reset(formValues);
    setFormKey(Date.now());
  }, [editingProduct, form]);

  const handleSubmit = async (values: ProductFormValues) => {
    try {
      console.log('Submitting product form with values:', values);
      
      // Validate required fields before submission
      if (!values.name?.trim()) {
        throw new Error(language === 'en' ? 'Product name is required' : 'Produktname ist erforderlich');
      }
      
      if (!values.description_de?.trim()) {
        throw new Error(language === 'en' ? 'Description is required' : 'Beschreibung ist erforderlich');
      }
      
      await onSubmit(values);
    } catch (error) {
      console.error('Error submitting product form:', error);
      // The error will be handled by the parent component
    }
  };

  // Show loading state
  if (formIsLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-center space-x-2 py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <div className="text-base">
            {language === 'en' ? 'Processing...' : 'Verarbeitung...'}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 shadow-md border-primary/10">
      <Form {...form} key={formKey}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
          <ProductFormHeader 
            editingProduct={editingProduct} 
            onCancel={onCancel}
            onSubmit={form.handleSubmit(handleSubmit)}
            isLoading={formIsLoading}
          />
          
          <ProductFormBasicInfo form={form} />
          
          <div className="bg-muted/30 p-6 rounded-lg border border-border/50 space-y-6">
            <ProductFormDelivery form={form} getUsedIcons={getUsedIcons} />
            
            <ProductFormGradient form={form} productId={editingProduct?.id} />
            
            <ProductFormCompensation form={form} />
          </div>
          
          <ProductFormMentorToggle form={form} />
          
          {/* Only show mentor-related fields if is_mentor_product is true */}
          {isMentorProduct && (
            <>
              <ProductFormMentorRequirements 
                form={form} 
                mentorGroups={mentorGroups} 
                loadingGroups={loadingGroups} 
              />
              
              <ProductFormApprovedMentors 
                form={form} 
                mentors={mentors} 
                loadingMentors={loadingMentors}
              />
            </>
          )}
          
          <ProductFormFooter 
            isLoading={formIsLoading} 
            editingProduct={editingProduct}
            onCancel={onCancel}
            className="mt-8"
          />
        </form>
      </Form>
    </Card>
  );
}

export type {
  ExtendedMentor,
  MentorGroupMemberResponse,
  ProductFormProps,
  ProductFormValues,
  ProductInfo,
} from '@/components/products/types';