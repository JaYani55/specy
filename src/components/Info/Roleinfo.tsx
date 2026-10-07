import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

const roleinfo = [
  {
    id: 1,
    title: 'Mitarbeitende',
    description: [
      'Für sie sichtbare Veranstaltungen sehen',
      'Anfragen, um an Veranstaltungen teilzunehmen',
      'Eigene Anfragen einsehen (ausstehend, angenommen, abgelehnt).',
      'Zugewiesene Veranstaltungen sehen, sobald die Anfrage bestätigt wurde.',
    ],
  },
  {
    id: 2,
    title: 'MitarbeiterInnen',
    description: [
      'Veranstaltungen erstellen, bearbeiten und löschen.',
      'Produkte verwalten (z. B. Kurse, Sessions).',
      'Mitarbeiter-Anfragen einsehen und bearbeiten (annehmen/ablehnen). (teilweise noch bug fixes nötig)',
      'Mitarbeitende manuell zu Veranstaltungen zuweisen.',
      'Profile von Mitarbeitenden und Kollegen ansehen.',
      'Zugang zum Verwaltungsbereich',
    ],
  },
  {
    id: 3,
    title: 'Mitarbeiter-Management',
    description: [
      'Alles, was Mitarbeiter können, plus:',
      'Mitarbeitende anlegen oder entfernen.',
      'Eigenschaften (“Traits”) von Mitarbeitenden festlegen oder ändern.',
      'Profile aller Mitarbeitenden ansehen und bearbeiten. (Username und Profil-Icon via mentorbooking, alles andere via seatable)',
    ],
  },
];

const Roleinfo = () => {
  const { language, theme } = useTheme();

  return (
    <>
      <h1
        id="rollen-heading"
        className="text-4xl font-extrabold mb-6 text-center"
      >
        {language === 'en' ? 'Roles' : 'Rollen'}
      </h1>

      <div className="space-y-6">
        {roleinfo.map(({ id, title, description }) => (
          <div
            key={id}
            className={`
              border rounded-lg p-5
              ${theme === 'dark'
                ? 'bg-gray-800 border-gray-700 text-gray-100'
                : 'bg-gray-100 border-gray-200 text-gray-900'}
            `}
          >
            <h2 className="text-lg font-semibold mb-2">{title}</h2>
            {Array.isArray(description) ? (
              <ul className="list-disc ml-6">
                {description.map((item, idx) => {
                  // Only color (teilweise noch bug fixes nötig) in blue
                  const bugfixText = '(teilweise noch bug fixes nötig)';
                  if (item.includes(bugfixText)) {
                    const [before, after] = item.split(bugfixText);
                    return (
                      <li key={idx} className="leading-relaxed mb-1">
                        {before}
                        <span className="text-blue-500">{bugfixText}</span>
                        {after}
                      </li>
                    );
                  }
                  return <li key={idx} className="leading-relaxed mb-1">{item}</li>;
                })}
              </ul>
            ) : (
              <p className="leading-relaxed">{description}</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
};

export default Roleinfo;
