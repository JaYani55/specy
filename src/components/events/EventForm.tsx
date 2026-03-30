import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as zod from 'zod';
import {
  Form,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme } from "../../contexts/ThemeContext";
import { EventStatus, EventMode } from '@/types/event';
import { format } from 'date-fns';
import { fetchProductById, Product } from '../../services/events/productService';
import { supabase } from "@/lib/supabase";
import { calculateEndTime } from '@/utils/timeUtils';
import { PastEventWarningDialog } from './PastEventWarningDialog';
import { ProductSection } from "./EventFormSections/ProductSection";
import { StaffSection } from "./EventFormSections/StaffSection";
import { CompanySection } from "./EventFormSections/CompanySection";
import { DateTimeSection } from "./EventFormSections/DateTimeSection";
import { AdditionalInfoAndLinkSection } from "./EventFormSections/AdditionalInfoAndLinkSection";
import { LockAndMentorCountSection } from "./EventFormSections/LockAndMentorCountSection";
import { FooterSection } from "./EventFormSections/FooterSection";
import { Users, Building2, CalendarDays, Info } from "lucide-react";

const formSchema = zod.object({
  company_id: zod.string().optional(),
  company: zod.string().trim().min(1, { message: "Company name is required" }),
  date: zod.string().min(1, { message: "Date is required" }),
  time: zod.string().min(1, { message: "Time is required" }),
  duration_minutes: zod.number().min(1, { message: "Duration is required" }),
  description: zod.string().optional(),
  status: zod.enum(['new', 'firstRequests', 'successPartly', 'successComplete', 'locked']),
  mode: zod.enum(['live', 'online', 'hybrid']).optional(),
  required_staff_count: zod.number().min(1, { message: "At least one staff member is required" }),
  required_trait_id: zod.number().nullable().optional(),
  product_id: zod.number().optional(),
  staff_members: zod.array(zod.string()).min(1, { message: "At least one staff member is required" }),
  teams_link: zod.string().optional(),
  initial_selected_mentors: zod.array(zod.string()).optional(),
  ProductInfo: zod.object({
    id: zod.number(),
    name: zod.string(),
    icon_name: zod.string().optional(),
    gradient: zod.string().optional(),
    description_de: zod.string(),
    description_effort: zod.string(),
  }).optional(),
});

export type EventFormValues = zod.infer<typeof formSchema>;

interface EventFormProps {
  initialValues?: {
    id?: string;
    company_id?: string;
    company?: string;
    date?: string;
    time?: string;
    end_time?: string;
    duration_minutes?: number;
    description?: string;
    status?: EventStatus;
    mode?: EventMode;
    required_staff_count?: number;
    required_trait_id?: number | null;
    product_id?: number;
    staff_members?: string[];
    teams_link?: string;
    initial_selected_mentors?: string[];
  };
  onSubmit: (values: EventFormValues) => Promise<void>;
  isLoading: boolean;
  mode: 'create' | 'edit';
}

export const EventForm: React.FC<EventFormProps> = ({
  initialValues,
  onSubmit,
  isLoading,
  mode
}) => {
  const { language } = useTheme();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});

  const form = useForm<EventFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      company_id: "",
      company: "",
      date: format(new Date(), 'yyyy-MM-dd'),
      time: '09:00',
      duration_minutes: 60,
      description: '',
      status: 'new',
      mode: 'online',
      required_staff_count: 1,
      required_trait_id: null,
      product_id: undefined,
      staff_members: [],
      teams_link: "",
      initial_selected_mentors: [],
    }
  });

  const isDirty = form.formState.isDirty;

  const selectedMode = form.watch('mode');
  const showTeamsLink = selectedMode === 'online' || selectedMode === 'hybrid';

  useEffect(() => {
    const warnUnsavedChanges = (e: BeforeUnloadEvent) => {
      if (isDirty && !isLoading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    
    window.addEventListener('beforeunload', warnUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnUnsavedChanges);
  }, [isDirty, isLoading]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log("EventForm initialValues:", initialValues);
    }
  }, [initialValues]);

  useEffect(() => {
    if (!initialValues) return;

    try {
      if (import.meta.env.DEV) {
        console.log("EventForm initializing with values:", initialValues);
        console.log("Product ID from initialValues:", initialValues.product_id, typeof initialValues.product_id);
      }

      const formValues: EventFormValues = {
        company_id: initialValues.company_id || "",
        company: initialValues.company || "",
        date: initialValues.date || format(new Date(), 'yyyy-MM-dd'),
        time: initialValues.time || '09:00',
        description: initialValues.description || '',
        status: initialValues.status || 'new',
        mode: initialValues.mode || 'online',
        required_staff_count:
          initialValues.required_staff_count != null
            ? Number(initialValues.required_staff_count)
            : 1,
        required_trait_id:
          initialValues.required_trait_id != null
            ? Number(initialValues.required_trait_id)
            : null,
        product_id: initialValues.product_id !== undefined ? Number(initialValues.product_id) : undefined,
        staff_members: initialValues.staff_members || [],
        teams_link: initialValues.teams_link || "",
        duration_minutes: initialValues.duration_minutes || 60,
        initial_selected_mentors: initialValues.initial_selected_mentors || [],
      };
      
      if (import.meta.env.DEV) {
        console.log("Setting form values:", formValues);
      }
      setTimeout(() => {
        form.reset(formValues);

        if (import.meta.env.DEV) {
          console.log("Form values after reset:", form.getValues());
        }
      }, 50);
    } catch (error) {
      console.error("Error setting form values:", error);
      console.error("Problem initialValues:", initialValues);
    }
  }, [initialValues, form]);

  const [showPastEventWarning, setShowPastEventWarning] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<EventFormValues | null>(null);

  const handleSubmit = async (values: EventFormValues) => {
    try {
      if (mode === 'create') {
        const selectedDate = new Date(values.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        selectedDate.setHours(0, 0, 0, 0);

        if (selectedDate < today) {
          setPendingSubmission(values);
          setShowPastEventWarning(true);
          return;
        }
      }

      await submitEvent(values);
    } catch (error) {
      console.error('Error submitting event form:', error);
    }
  };

  const submitEvent = async (values: EventFormValues) => {
    if (values.product_id) {
      const productDetails = await fetchProductById(values.product_id);

      if (productDetails) {
        values.ProductInfo = {
          id: productDetails.id,
          name: productDetails.name,
          icon_name: productDetails.icon_name,
          gradient: productDetails.gradient,
          description_de: productDetails.description_de,
          description_effort: productDetails.description_effort,
        };
      }
    }
    
    await onSubmit(values);
  };

  const watchedProductId = form.watch('product_id');
  const watchedTime = form.watch('time');
  const watchedDuration = form.watch('duration_minutes');

  useEffect(() => {
    const fetchSelectedProduct = async () => {
      const productId = form.getValues('product_id');
      if (productId) {
        try {
          const product = await fetchProductById(productId);
          setSelectedProduct(product);

          if (
            product?.min_amount_mentors != null &&
            (mode === 'create' || !form.getValues('required_staff_count'))
          ) {
            form.setValue('required_staff_count', product.min_amount_mentors, { shouldDirty: true });
          }
        } catch (error) {
          console.error('Error fetching product details:', error);
        }
      } else {
        setSelectedProduct(null);
      }
    };

    void fetchSelectedProduct();
  }, [watchedProductId, form, mode]);

  useEffect(() => {
    const fetchGroupNames = async () => {
      try {
        const { data, error } = await supabase
          .from('mentor_groups')
          .select('id, group_name');
          
        if (error) {
          console.error('Error fetching traits:', error);
          return;
        }

        const groupMap = data.reduce((acc, group) => {
          acc[group.id] = group.group_name;
          return acc;
        }, {} as Record<string, string>);
        
        setGroupNames(groupMap);
      } catch (err) {
        console.error('Error in fetchGroupNames:', err);
      }
    };

    void fetchGroupNames();
  }, []);

  const endTime = React.useMemo(() => {
    if (watchedTime && watchedDuration) {
      return calculateEndTime(watchedTime, watchedDuration);
    }
    return '';
  }, [watchedTime, watchedDuration]);

  return (
    <Card className="w-full bg-background/80 shadow-xl border-none rounded-2xl p-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-2xl font-bold">
          {mode === 'create'
            ? language === 'en' ? 'Create New Event' : 'Neue Veranstaltung erstellen'
            : language === 'en' ? 'Edit Event' : 'Veranstaltung bearbeiten'
          }
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-10">
            {/* Product Section */}
            <div>
              <ProductSection
                form={form}
                selectedProduct={selectedProduct}
                groupNames={groupNames}
                isLoading={isLoading}
                language={language}
              />
            </div>
            {/* Staff Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Staff" : "Mitarbeiter"}</span>
              </div>
              <StaffSection
                form={form}
                isLoading={isLoading}
                language={language}
              />
            </div>
            {/* Company Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Building2 className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Company" : "Unternehmen"}</span>
              </div>
              <CompanySection
                form={form}
                isLoading={isLoading}
                language={language}
              />
            </div>
            {/* Date & Time Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CalendarDays className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Date & Time" : "Datum & Zeit"}</span>
              </div>
              <DateTimeSection
                form={form}
                endTime={endTime}
                language={language}
              />
            </div>
            {/* Required Staff Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Required Staff" : "Benötigte Mitarbeiter"}</span>
              </div>
              <LockAndMentorCountSection
                form={form}
                selectedProduct={selectedProduct}
                language={language}
                isLoading={isLoading}
              />
            </div>
            {/* Additional Info Section */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-6 w-6 text-primary" />
                <span className="font-semibold text-xl">{language === "en" ? "Special Info" : "Spezielle Infos"}</span>
              </div>
              <AdditionalInfoAndLinkSection
                form={form}
                showTeamsLink={showTeamsLink}
                language={language}
              />
            </div>
            <FooterSection
              isLoading={isLoading}
              mode={mode}
              language={language}
            />
          </form>
        </Form>
      </CardContent>
      <PastEventWarningDialog
        open={showPastEventWarning}
        onOpenChange={setShowPastEventWarning}
        selectedDate={pendingSubmission?.date || ''}
        onContinueCreate={async () => {
          if (pendingSubmission) {
            setShowPastEventWarning(false);
            await submitEvent(pendingSubmission);
            setPendingSubmission(null);
          }
        }}
      />
    </Card>
  );
};