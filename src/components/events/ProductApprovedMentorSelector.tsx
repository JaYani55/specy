import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function ProductApprovedMentorSelector({
  approvedMentorIds,
  selectedMentors,
  onChange,
  disabled,
  language = "en",
  checkboxClassName = "",
  checkmarkClassName = "",
}: {
  approvedMentorIds: string[];
  selectedMentors: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  language?: "en" | "de";
  checkboxClassName?: string;
  checkmarkClassName?: string;
}) {
  const [mentors, setMentors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!approvedMentorIds.length) {
      setMentors([]);
      return;
    }
    setLoading(true);

    (async () => {
      try {
        const { data } = await supabase
          .from("user_profile")
          .select("user_id, Username")
          .in("user_id", approvedMentorIds);

        setMentors(
          (data || []).map((m) => ({
            id: m.user_id,
            name: m.Username || "Unknown",
          }))
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [approvedMentorIds]);

  if (loading)
    return <div>{language === "en" ? "Loading staff..." : "Lade Mitarbeitende..."}</div>;
  if (!mentors.length)
    return <div>{language === "en" ? "No staff available." : "Keine Mitarbeitenden verfügbar."}</div>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {mentors.map((mentor) => {
        const checked = selectedMentors.includes(mentor.id);
        return (
          <label key={mentor.id} className="flex items-center gap-3 cursor-pointer select-none">
            <span className="relative flex items-center">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => {
                  if (checked) onChange(selectedMentors.filter((id) => id !== mentor.id));
                  else onChange([...selectedMentors, mentor.id]);
                }}
                disabled={disabled}
                className={
                  "w-7 h-7 appearance-none rounded-md border-2 border-gray-300 bg-white " +
                  "checked:bg-green-500 " +
                  "hover:border-green-500 hover:ring-2 hover:ring-green-400 transition-all flex items-center justify-center " +
                  checkboxClassName
                }
                style={{ minWidth: "1.75rem", minHeight: "1.75rem" }}
              />
              {checked && (
                <span
                  className={
                    "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 " +
                    (checkmarkClassName || "text-white text-2xl")
                  }
                >
                  {/* Modern white checkmark SVG */}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <polyline points="20 6 10 18 4 12" />
                  </svg>
                </span>
              )}
            </span>
            <span className="text-base">{mentor.name}</span>
          </label>
        );
      })}
    </div>
  );
}