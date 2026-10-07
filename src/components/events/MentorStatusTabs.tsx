import React, { useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { Check, XCircle, Clock, Users } from "lucide-react";
import { motion, Variants } from "framer-motion";
import { supabase } from '@/lib/supabase';
import { isEventInPast } from '@/utils/eventUtils';
import { usePermissions } from '@/hooks/usePermissions';
import { Event } from "@/types/event";

interface MentorStatusPanelProps {
  event: Event;
  acceptedMentorProfiles: Array<{ id: string; name: string; profilePic?: string }>;
  declinedMentorProfiles: Array<{ id: string; name: string; profilePic?: string }>;
  language: 'en' | 'de';
  isPastEvent?: boolean;
}

// Animation variants
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } }
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } }
};

export const MentorStatusPanel: React.FC<MentorStatusPanelProps> = ({
  event,
  acceptedMentorProfiles,
  declinedMentorProfiles,
  language,
  isPastEvent: externalIsPastEvent
}) => {
  const { canViewMentorProfiles } = usePermissions();

  const [directDbCounts, setDirectDbCounts] = useState({
    acceptedCount: event?.acceptedMentors?.length || 0,
    requiredCount: event?.amount_requiredmentors || 1
  });

  useEffect(() => {
    if (!event?.id) return;
    const fetchDirectCounts = async () => {
      try {
        const { data, error } = await supabase
          .from('mentorbooking_events')
          .select('accepted_mentors, amount_requiredmentors')
          .eq('id', event.id)
          .single();
        if (error) throw error;
        setDirectDbCounts({
          acceptedCount: data.accepted_mentors?.length || 0,
          requiredCount: data.amount_requiredmentors || 1
        });
      } catch (err) {
        console.error("Error fetching direct counts:", err);
      }
    };
    fetchDirectCounts();
  }, [event?.id, acceptedMentorProfiles]);

  const progressPercentage = Math.min(
    100,
    (directDbCounts.acceptedCount / directDbCounts.requiredCount) * 100
  );
  const totalMentorCount = acceptedMentorProfiles.length + declinedMentorProfiles.length;
  const isPastEvent =
    externalIsPastEvent !== undefined
      ? externalIsPastEvent
      : isEventInPast(event);

  if (!canViewMentorProfiles) return null;

  const renderMentorProfile = (mentor: { id: string; name: string; profilePic?: string }) =>
    canViewMentorProfiles ? (
      <Link
        to={`/profile/${mentor.id}`}
        className="font-medium hover:text-primary hover:underline transition-colors"
      >
        {mentor.name}
      </Link>
    ) : (
      <span className="font-medium">{mentor.name}</span>
    );

  return (
    <div className="border-t pt-6 mt-2">
      {/* Past-event banner */}
      {isPastEvent && (
        <div className="bg-muted/20 rounded-md p-3 mb-6 border border-muted">
          <p className="text-sm text-muted-foreground flex items-center">
            <Clock className="h-4 w-4 mr-2" />
            {language === "en"
              ? "This event has already taken place. Actions are no longer available."
              : "Diese Veranstaltung hat bereits stattgefunden. Aktionen sind nicht mehr verfügbar."}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-semibold flex items-center gap-2 text-primary">
          <Users className="h-5 w-5" />
          {language === "en" ? "Staff Status" : "Mitarbeiter-Status"}
        </h3>
        <Badge variant="outline" className="px-2.5 py-1 text-sm bg-primary/5">
          <span className="font-semibold">{totalMentorCount}</span>
          <span className="ml-1 font-normal">
            {language === "en" ? "total staff" : "Mitarbeitende insgesamt"}
          </span>
        </Badge>
      </div>

      {/* Assigned & Declined side-by-side */}
      <motion.div
        className="grid sm:grid-cols-2 gap-6"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        {/* Assigned Mentors */}
        <div className="bg-card rounded-xl p-4 border shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              {language === "en" ? "Assigned Staff" : "Zugewiesene Mitarbeitende"}
            </h4>

            {/* X / Y in green */}
            <Badge
              className="bg-green-100 text-green-800 border-green-300 text-lg px-3 py-1 font-bold rounded-xl shadow-sm"
              style={{ fontSize: "1.0rem", minWidth: "48px", textAlign: "center" }}
            >
              {directDbCounts.acceptedCount}/{directDbCounts.requiredCount}
            </Badge>
          </div>

          {acceptedMentorProfiles.length === 0 ? (
            <div className="text-center py-8">
              <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                {language === "en"
                  ? "No assigned staff yet"
                  : "Noch keine zugewiesenen Mitarbeitende"}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {acceptedMentorProfiles.map((mentor) => (
                <motion.li
                  key={mentor.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-green-50 transition-colors"
                  variants={itemVariants}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-green-200 dark:border-green-900/50">
                      <AvatarImage src={mentor.profilePic} />
                      <AvatarFallback className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                        {mentor.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {renderMentorProfile(mentor)}
                  </div>
                  <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700/50">
                    <Check className="h-3.5 w-3.5 mr-1" />
                    {language === "en" ? "Assigned" : "Zugewiesen"}
                  </Badge>
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {/* Declined Mentors */}
        <div className="bg-card rounded-xl p-4 border shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              {language === "en" ? "Declined Staff" : "Abgelehnte Mitarbeitende"}
            </h4>
            <Badge
              className="bg-red-100 text-red-800 border-red-300 text-lg px-3 py-1 font-bold rounded-xl shadow-sm"
              style={{ fontSize: "1.0rem", minWidth: "48px", textAlign: "center" }}
            >
              {declinedMentorProfiles.length}
            </Badge>
          </div>

          {declinedMentorProfiles.length === 0 ? (
            <div className="text-center py-8">
              <XCircle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground">
                {language === "en"
                  ? "No declined staff"
                  : "Keine abgelehnten Mitarbeitende"}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {declinedMentorProfiles.map((mentor) => (
                <motion.li
                  key={mentor.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-red-50 transition-colors"
                  variants={itemVariants}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-red-200 dark:border-red-800/50">
                      <AvatarImage src={mentor.profilePic} />
                      <AvatarFallback className="bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                        {mentor.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    {renderMentorProfile(mentor)}
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </div>
  );
};
