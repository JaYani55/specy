import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

const Legal = () => {
  const { theme } = useTheme();

  const sectionClass = `border rounded-lg p-5 mb-6 ${
    theme === 'dark'
      ? 'bg-gray-800 border-gray-700 text-gray-100'
      : 'bg-gray-100 border-gray-200 text-gray-900'
  }`;

  const headingClass = 'text-base font-semibold uppercase tracking-wide mb-3 text-blue-500';

  return (
    <>
      <h1 className="text-4xl font-extrabold mb-2 text-center">Legal Notice</h1>
      <p className={`text-center mb-8 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
        Specy — Copyright, Attribution, and Licensing
      </p>

      <div className={sectionClass}>
        <h2 className={headingClass}>Copyright</h2>
        <p className="leading-relaxed">
          Specy (including legacy references to Service-CMS, ServiceCMS, Server-CMS, and ServerCMS)
          <br />
          Copyright 2026, Jan-Alban Rathjen (also known as &apos;Jay Rathjen&apos;),
          <br />
          acting in the name of the Specy Project Authors.
        </p>
        <p className={`mt-3 text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          Project Website:{' '}
          <a
            href="https://pluracon.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://pluracon.org
          </a>
        </p>
      </div>

      <div className={sectionClass}>
        <h2 className={headingClass}>Project Stewardship &amp; Governance</h2>
        <p className="leading-relaxed mb-3">
          Jan-Alban Rathjen (&quot;Jay Rathjen&quot;) serves as the Founding Steward and Project
          Lead of the Specy Project. The Steward maintains the exclusive right to manage
          project assets, including the authority to transfer all copyrights, trademarks, and
          management responsibilities to a non-profit foundation or a successor legal entity at
          their sole discretion.
        </p>
        <p className="leading-relaxed">
          The Steward is committed to transferring the Specy trademarks and names to a
          neutral, independent legal entity once the project has sufficiently organized itself to
          ensure long-term sustainability.
        </p>
      </div>

      <div className={sectionClass}>
        <h2 className={headingClass}>Attribution &amp; Integrity</h2>
        <p className="leading-relaxed mb-3">
          Pursuant to the obligations of the EUPL, any distribution or communication of the
          software, including providing access via a network or SaaS, must retain this NOTICE file
          and all original copyright and attribution notices.
        </p>
        <p className="leading-relaxed mb-3">
          If the software is used in a web-hosted environment, a visible link to the contributor
          list, for example via /info/legal, must be maintained to satisfy the communication to the
          public requirements of the EUPL.
        </p>
        <p className="font-medium mb-2">Core Contributors:</p>
        <ul className={`list-disc list-inside space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
          <li>Mira Weitner</li>
          <li>Jay Rathjen</li>
        </ul>
      </div>

      <div className={sectionClass}>
        <h2 className={headingClass}>Permissions &amp; Trademarks</h2>
        <ol className={`list-decimal list-inside space-y-3 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
          <li>
            <span className="font-medium text-inherit">Copyleft:</span>{' '}
            This software is subject to the copyleft provisions of the EUPL. Any derivative work
            distributed or made available over a network must be licensed under the EUPL or a
            compatible license listed in the EUPL appendix.
          </li>
          <li>
            <span className="font-medium text-inherit">Notice Retention:</span>{' '}
            Redistribution or public communication of the work must preserve the project NOTICE file
            and original attribution notices.
          </li>
          <li>
            <span className="font-medium text-inherit">Trademark:</span>{' '}
            The names &ldquo;Specy&rdquo; and its derivatives remain trademarks of the Project
            Steward until formal transfer to a legal entity. Their use is permitted only for
            factual attribution.
          </li>
        </ol>
      </div>

      <p className={`text-xs text-center mt-4 ${theme === 'dark' ? 'text-gray-600' : 'text-gray-400'}`}>
        Licensed under the European Union Public Licence v. 1.2 (EUPL)
      </p>
    </>
  );
};

export default Legal;