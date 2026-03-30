import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Event } from '@/types/event';
import { useAuth } from './AuthContext';
import { QUERY_KEYS } from '../constants/queryKeys';
import { supabase } from '../lib/supabase';
import { fetchStaffNames } from '../utils/staffUtils';
// NEU: Importiere fetchProducts und Product
import { fetchProducts, Product } from '@/services/events/productService';
// NEU: Importiere ensureProductGradient
import { ensureProductGradient } from '@/services/events/productService';
import type { UserProfileRecord } from '@/types/auth';

// Define types for our context
interface DataContextType {
  events: Event[] | undefined;
  isLoadingEvents: boolean;
  eventsError: Error | null;
  products: Product[] | undefined; // NEU
  isLoadingProducts: boolean; // NEU
  productsError: Error | null; // NEU
  refetchEvents: () => Promise<void>;
  refetchAllData: () => Promise<void>;
  getEventById: (id: string) => Event | undefined;
  getUserProfile: (userId: string) => Promise<UserProfileRecord | null>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // --- NEU: QUERIES FÜR PRODUKTE ---
  const {
    data: products,
    isLoading: isLoadingProducts,
    error: productsError,
    refetch: refetchProducts,
  } = useQuery<Product[], Error>({
    queryKey: [QUERY_KEYS.PRODUCTS],
    queryFn: async () => {
      const fetchedProducts = await fetchProducts();
      return fetchedProducts.map(p => ensureProductGradient(p));
    },
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
    enabled: !!user && user.hasAccess
  });
  // --- ENDE NEUE PRODUKT-QUERIES ---

  // --- ANPASSUNG fetchEventsFromAPI: ProductInfo Join entfernen ---
  const fetchEventsFromAPI = useCallback(async (): Promise<Event[]> => {
    const { data, error } = await supabase
      .from('mentorbooking_events')
      .select(`* , product_id`)
      .order('date', { ascending: true });

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return [];
    }

    const allStaffIds = new Set<string>();
    data.forEach(event => {
      if (event.staff_members && Array.isArray(event.staff_members)) {
        event.staff_members.forEach(id => {
          if (id && typeof id === 'string') {
            allStaffIds.add(id);
          }
        });
      }
    });
    const staffNames = await fetchStaffNames([...allStaffIds]);

    const transformedEvents = data
      .filter(event => event && typeof event === 'object')
      .map(event => {
        const staffMembers = event.staff_members && Array.isArray(event.staff_members) && event.staff_members.length > 0
          ? event.staff_members.filter(id => id && typeof id === 'string')
          : [];
        const primaryStaffId = staffMembers[0] || '';
        const primaryStaffName = staffNames[primaryStaffId] || 'Unknown';
        return {
          id: event.id,
          title: event.company || '',
          company_id: event.company_id || '',
          company: event.company || '',
          date: event.date || '',
          time: event.time || '',
          end_time: event.end_time || '',
          duration_minutes: event.duration_minutes || null,
          description: event.description || '',
          staff_members: staffMembers,
          primaryStaffId: primaryStaffId,
          primaryStaffName: primaryStaffName,
          staffNames: staffMembers.map(id => staffNames[id] || 'Unknown'),
          staffProfilePicture: event.staffProfilePicture || null,
          status: event.status || 'new',
          mode: event.mode || 'online',
          requestingMentors: event.requesting_mentors || [],
          acceptedMentors: event.accepted_mentors || [],
          declinedMentors: event.declined_mentors || [],
          amount_requiredmentors: event.amount_requiredmentors || 1,
          required_staff_count: event.required_staff_count || event.amount_requiredmentors || 1,
          required_trait_id: event.required_trait_id ?? null,
          product_id: event.product_id,
          teams_link: event.teams_link || '',
          initial_selected_mentors: event.initial_selected_mentors || [],
        };
      });
    return transformedEvents;
  }, []);

  const {
    data: events,
    isLoading: isLoadingEvents,
    error: eventsError,
    refetch
  } = useQuery({
    queryKey: [QUERY_KEYS.EVENTS],
    queryFn: fetchEventsFromAPI,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
    enabled: !!user && user.hasAccess
  });

  const refetchEvents = useCallback(async () => {
    try {
      const freshEvents = await fetchEventsFromAPI();
      queryClient.setQueryData([QUERY_KEYS.EVENTS], freshEvents || []);
      await refetch();
    } catch (error) {
      queryClient.setQueryData([QUERY_KEYS.EVENTS], []);
      throw error;
    }
  }, [fetchEventsFromAPI, queryClient, refetch]);

  useEffect(() => {
    if (!user?.hasAccess) return;

    const channel = supabase.channel('events_changes');

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'mentorbooking_events',
        filter: `requesting_mentors=cs.{${user.id}}`
      },
      (payload) => {
        console.log('Realtime: requesting_mentors changed', payload);
        void refetchEvents();
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'mentorbooking_events',
        filter: `accepted_mentors=cs.{${user.id}}`
      },
      (payload) => {
        console.log('Realtime: accepted_mentors changed', payload);
        void refetchEvents();
      }
    );

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'mentorbooking_events',
        filter: `declined_mentors=cs.{${user.id}}`
      },
      (payload) => {
        console.log('Realtime: declined_mentors changed', payload);
        void refetchEvents();
      }
    );

    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user?.id, user?.hasAccess, refetchEvents]);

  // Add a new comprehensive data refresh function
  const refetchAllData = useCallback(async () => {
    await refetchProducts();
    const freshEvents = await fetchEventsFromAPI();
    queryClient.setQueryData([QUERY_KEYS.EVENTS], freshEvents || []);

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.USER_PROFILE] }),
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SEATABLE_MENTORS] })
    ]);

    await refetch();
  }, [fetchEventsFromAPI, queryClient, refetch, refetchProducts]);

  // Helper to get a single event by ID from the cache
  const getEventById = useCallback((id: string): Event | undefined => {
    return events?.find(event => event.id === id);
  }, [events]);

  // Get user profile from cache or API
  const getUserProfile = useCallback(async (userId: string): Promise<UserProfileRecord | null> => {
    try {
      const { data, error } = await supabase
        .from('user_profile')
        .select('user_id, Username, profile_picture_url')
        .eq('user_id', userId)
        .single<UserProfileRecord>();

      if (error) {
        return null;
      }

      return data ?? null;
    } catch (error) {
      console.error('[DataContext] Error fetching user profile:', error);
      return null;
    }
  }, []);

  // Make sure the DataProvider returns JSX
  return (
    <DataContext.Provider value={{
      events,
      isLoadingEvents,
      eventsError: eventsError as Error | null,
      products, // NEU
      isLoadingProducts, // NEU
      productsError: productsError as Error | null, // NEU
      refetchEvents,
      refetchAllData,
      getEventById,
      getUserProfile
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};