import { useState, useEffect, useMemo } from 'react';
import { Loader2, Clock, Package, MessageSquarePlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { fetchProductById, Product } from '@/services/events/productService';
import type { ProductInfo } from '@/components/products/types';
import { getIconByName } from '@/constants/pillaricons';
import { useTheme } from '@/contexts/ThemeContext';
import { Card } from '@/components/ui/card';
import { usePermissions } from '@/hooks/usePermissions';
import { getEventTimeDisplay } from '@/utils/timeUtils';
import { supabase } from '../lib/supabase';
import { isEventInPast } from '@/utils/eventUtils';

import { useEventDetail } from '@/hooks/useEventDetail';
import useEventActions from '@/hooks/useEventActions';

import { EventDetailHeader } from '@/components/events/EventDetailHeader';
import { EventInfoCard } from '@/components/events/EventInfoCard';
import { DeleteEventDialog } from '@/components/events/DeleteEventDialog';
import { EventStaffAssignment } from '@/components/events/EventStaffAssignment';

type DisplayProduct = {
  id: number;
  name: string;
  description_de: string;
  description_effort: string;
  icon_name?: string;
  gradient?: string;
  assigned_groups?: number[];
  salary_type?: Product['salary_type'];
  salary?: number;
  min_amount_mentors?: number;
  max_amount_mentors?: number;
  approved?: string[];
  is_mentor_product?: boolean;
};

const buildDisplayProduct = (
  product: Product | null,
  info?: ProductInfo
): DisplayProduct | null => {
  if (product) {
    return {
      id: product.id,
      name: product.name,
      description_de: product.description_de,
      description_effort: product.description_effort,
      icon_name: product.icon_name ?? info?.icon_name,
      gradient: product.gradient ?? info?.gradient,
      assigned_groups: product.assigned_groups,
      salary_type: product.salary_type,
      salary: product.salary,
      min_amount_mentors: product.min_amount_mentors,
      max_amount_mentors: product.max_amount_mentors,
      approved: product.approved,
      is_mentor_product: product.is_mentor_product,
    };
  }

  if (info) {
    return {
      id: info.id,
      name: info.name,
      description_de: info.description_de ?? '',
      description_effort: info.description_effort ?? '',
      icon_name: info.icon_name,
      gradient: info.gradient,
    };
  }

  return null;
};

const EventDetail = () => {
  const { refetchEvents, getUserProfile } = useData();
  const { language, theme } = useTheme();
  const permissions = usePermissions();
  const { user } = useAuth();

  const [productDetails, setProductDetails] = useState<Product | null>(null);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);

  const { 
    id,
    event, 
    setEvent, 
    isEventOwner,
    isMentor,
    isAcceptedMentor,
    hasAlreadyRequested,
    reloadEvent
  } = useEventDetail();

  const {
    isDeleting,
    showDeleteDialog,
    setShowDeleteDialog,
    handleDeleteEvent,
    handleUpdateStaffMembers
  } = useEventActions(event, setEvent);

  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [selectedMentorNames, setSelectedMentorNames] = useState<{name: string}[]>([]);

  useEffect(() => {
    const loadProductDetails = async () => {
      if (!event?.product_id) {
        setProductDetails(event?.ProductInfo
          ? {
              id: event.ProductInfo.id,
              name: event.ProductInfo.name,
              description_de: event.ProductInfo.description_de ?? '',
              description_effort: event.ProductInfo.description_effort ?? '',
              icon_name: event.ProductInfo.icon_name,
              gradient: event.ProductInfo.gradient,
            }
          : null);
        return;
      }

      setIsLoadingProduct(true);
      try {
        const product = await fetchProductById(event.product_id);
        if (product) {
          setProductDetails(product);
        } else if (event.ProductInfo) {
          setProductDetails({
            id: event.ProductInfo.id,
            name: event.ProductInfo.name,
            description_de: event.ProductInfo.description_de ?? '',
            description_effort: event.ProductInfo.description_effort ?? '',
            icon_name: event.ProductInfo.icon_name,
            gradient: event.ProductInfo.gradient,
          });
        } else {
          setProductDetails(null);
        }
      } catch (error) {
        console.error('Error loading product details:', error);
        if (event?.ProductInfo) {
          setProductDetails({
            id: event.ProductInfo.id,
            name: event.ProductInfo.name,
            description_de: event.ProductInfo.description_de ?? '',
            description_effort: event.ProductInfo.description_effort ?? '',
            icon_name: event.ProductInfo.icon_name,
            gradient: event.ProductInfo.gradient,
          });
        } else {
          setProductDetails(null);
        }
      } finally {
        setIsLoadingProduct(false);
      }
    };

    loadProductDetails();
  }, [event?.product_id, event?.ProductInfo]);

  useEffect(() => {
    const loadAdditionalData = async () => {
      if (event?.initial_selected_mentors && event.initial_selected_mentors.length > 0) {
        try {
          const { data, error } = await supabase
            .from('user_profile')
            .select('user_id, Username')
            .in('user_id', event.initial_selected_mentors);
          if (!error && data) {
            const mentorNames = data.map(mentor => ({
              name: mentor.Username || 'Unknown'
            }));
            setSelectedMentorNames(mentorNames);
          }
        } catch (error) {
          console.error('Error loading selected mentor names:', error);
        }
      } else {
        setSelectedMentorNames([]);
      }

      const assignedGroupIds = productDetails?.assigned_groups ?? event?.ProductInfo?.assigned_groups ?? [];

      if (assignedGroupIds.length > 0) {
        try {
          const { data, error } = await supabase
            .from('mentor_groups')
            .select('id, group_name')
            .in('id', assignedGroupIds);
          if (!error && data) {
            const groupMap = data.reduce((acc, group) => {
              acc[group.id] = group.group_name;
              return acc;
            }, {} as Record<string, string>);
            setGroupNames(groupMap);
          }
        } catch (error) {
          console.error('Error loading group names:', error);
        }
      }
    };

    loadAdditionalData();
  }, [event, productDetails]);

  const isPastEvent = event ? isEventInPast(event) : false;

  const currentProduct = useMemo(
    () => buildDisplayProduct(productDetails, event?.ProductInfo),
    [productDetails, event?.ProductInfo]
  );

  // Handle mentor action submission
  const handleMentorActionsProcessed = async () => {
    // Do NOT call refetchEvents here!
    reloadEvent();
  };

  if (!id) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-500">
          {language === "en" ? "Invalid event ID" : "Ungültige Event-ID"}
        </p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user?.role === 'mentor' && event && !permissions.canMentorViewEvent({ initial_selected_mentors: event.initial_selected_mentors || [] })) {
    // Mentor not allowed to view this event
    return <div className="flex flex-col items-center justify-center h-64"><p className="text-red-500">Not Found</p></div>;
  }

  return (
    <div className="container mx-auto p-4 pb-20">
      <EventDetailHeader
        event={event}
        isEventOwner={isEventOwner}
        onDeleteClick={() => setShowDeleteDialog(true)}
        isPastEvent={isPastEvent}
      />

      {isPastEvent && (
        <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md">
          <p className="text-sm text-muted-foreground flex items-center">
            <Clock className="h-4 w-4 mr-2" />
            {language === "en" 
              ? "This event has already taken place. Actions are no longer available." 
              : "Diese Veranstaltung hat bereits stattgefunden. Aktionen sind nicht mehr verfügbar."}
          </p>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          {currentProduct?.icon_name && (
            <div className="flex-shrink-0">
              <img
                src={getIconByName(currentProduct.icon_name, theme === "dark")}
                alt={currentProduct.name}
                className="w-12 h-12"
              />
            </div>
          )}
          <div>
            <h1 className="text-3xl font-bold">
              {currentProduct?.name || (language === "en" ? "Event Details" : "Veranstaltungsdetails")}
            </h1>
            {event.company && (
              <p className="text-xl text-muted-foreground mt-1">
                {language === "en" ? "at" : "bei"} {event.company}
              </p>
            )}
          </div>
        </div>
        {currentProduct?.gradient && (
          <div 
            className="h-24 rounded-lg shadow-inner flex items-center justify-center mb-6"
            style={{ background: currentProduct.gradient }}
          >
            <div className="bg-white/10 backdrop-blur-sm rounded-lg px-6 py-2">
              <p className="text-white font-medium text-lg">
                {event.date} • {getEventTimeDisplay(event, language)}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <EventInfoCard 
            event={event} 
            refreshEventData={handleMentorActionsProcessed}
            isPastEvent={isPastEvent}
          />
          {permissions.canAssignMentors && (
            <EventStaffAssignment
              event={event}
              isPastEvent={isPastEvent}
              onSave={handleUpdateStaffMembers}
            />
          )}
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="space-y-8">
              
              {/* Product Description Section */}
              <div>
                <h3 className="text-2xl font-semibold mb-4">
                  {currentProduct?.name || (language === "en" ? "Event Description" : "Veranstaltungsbeschreibung")}
                </h3>
                
                {currentProduct?.description_de ? (
                  <div className="prose prose-lg max-w-none">
                    <p className="text-lg leading-relaxed whitespace-pre-wrap text-foreground">
                      {currentProduct.description_de}
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground italic text-lg">
                      {language === "en" 
                        ? "No product description available." 
                        : "Keine Produktbeschreibung verfügbar."}
                    </p>
                  </div>
                )}
              </div>

              {/* Product Requirements & Details Section */}
              {currentProduct && (
                <div className="border-t pt-6">
                  <h3 className="text-xl font-semibold mb-6">
                    {language === "en" ? "Product Details & Requirements" : "Produktdetails & Anforderungen"}
                  </h3>
                  
                  <div className="space-y-6">
                    {/* Effort Description */}
                    {currentProduct.description_effort && (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-6 rounded-lg border border-blue-200/50 dark:border-blue-800/50">
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                            <Clock className="h-4 w-4 text-white" />
                          </div>
                          <div>
                            <h4 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
                              {language === "en" ? "What's Expected" : "Was erwartet wird"}
                            </h4>
                            <p className="text-blue-800 dark:text-blue-200 whitespace-pre-wrap leading-relaxed">
                              {currentProduct.description_effort}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Compensation */}
                    <div>
                      <h4 className="font-semibold text-base mb-3 flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        {language === "en" ? "Compensation" : "Vergütung"}
                      </h4>
                      <p className="text-muted-foreground">
                        {currentProduct.salary_type || 'Standard'}
                        {currentProduct.salary_type !== 'Standard' && currentProduct.salary != null && (
                          <>: {currentProduct.salary_type === "Fixpreis"
                            ? `${currentProduct.salary.toFixed(2)}€`
                            : `${currentProduct.salary.toFixed(2)}€/h`}
                          </>
                        )}
                      </p>
                    </div>

                    {/* Required Skills/Traits - ALWAYS SHOW, even if none */}
                    <div>
                      <h4 className="font-semibold text-base mb-3">
                        {language === "en" ? "Required Skills" : "Erforderliche Fähigkeiten"}
                      </h4>
                      {currentProduct.assigned_groups && currentProduct.assigned_groups.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {currentProduct.assigned_groups.map((groupId, index) => (
                            <span key={index} className="text-sm px-3 py-1 bg-muted rounded-md">
                              {groupNames[groupId] || `Skill ${groupId}`}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic">
                          {language === "en" ? "None" : "Keine"}
                        </p>
                      )}
                    </div>

                    {/* Selected team members who can see this event */}
                    {event.initial_selected_mentors && event.initial_selected_mentors.length > 0 && (
                      <div>
                        <h4 className="font-semibold text-base mb-3 text-green-800 dark:text-green-200">
                          {language === "en" ? "Team Members Who Can See This Event" : "Teammitglieder, die diese Veranstaltung sehen können"}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedMentorNames.map((mentor, index) => (
                            <span key={index} className="text-sm px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-md">
                              {mentor.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Is Mentor Product Badge */}
                    {currentProduct.is_mentor_product && (
                      <div>
                        <h4 className="font-semibold text-base mb-2 text-purple-800 dark:text-purple-200 flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          {language === "en" ? "Special Product Type" : "Besondere Produktart"}
                        </h4>
                        <p className="text-purple-700">
                          {language === "en" ? "Staff Product" : "Mitarbeiter-Produkt"}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* Additional Event-Specific Information */}
              {event.description && event.description.trim() !== '' && (
                <div className="border-t pt-6">
                  <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                    <MessageSquarePlus className="h-5 w-5" />
                    {language === "en" 
                      ? "Additional Information for This Event" 
                      : "Zusätzliche Informationen für dieses Event"}
                  </h3>
                  <div className="bg-amber-50/50 dark:bg-amber-900/10 p-6 rounded-lg border border-amber-200/30">
                    <p className="whitespace-pre-wrap text-lg leading-relaxed">
                      {event.description}
                    </p>
                  </div>
                </div>
              )}

            </div>
          </Card>
        </div>
      </div>

      <DeleteEventDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onDelete={handleDeleteEvent}
        isDeleting={isDeleting}
        event={event}
      />
    </div>
  );
};

export default EventDetail;