import React from "react";
import { Link } from "react-router-dom";
import { HelpCircle, ArrowRight, BookOpen, Tag, Bookmark, ListChecks, Link2 } from "lucide-react";

/**
 * Big "Help" call-to-action card surfaced on the welcome dashboard.
 *
 * The intent is to make the help guide impossible to miss for new users
 * (especially first-time uploaders who haven't found the `/help` link in
 * the nav yet). Lists a handful of recent / hot topics as quick-links
 * into the dedicated sections of ``pages/Help.jsx``.
 */
const QUICK_LINKS = [
  { to: "/help#uploading", label: "Uploading EPUBs / PDFs / Kindle", icon: BookOpen },
  { to: "/help#ao3-metadata", label: "AO3 metadata + filters", icon: Tag },
  { to: "/help#smart-shelves", label: "Smart shelves & saved filters", icon: Bookmark },
  { to: "/help#reading-queue", label: "Reading queue (Up next)", icon: ListChecks },
  { to: "/help#filter-urls", label: "Filter out URLs you already own", icon: Link2 },
];

export default function DashboardHelpCard() {
  return (
    <section
      data-testid="dashboard-help-card"
      className="shelf-card p-6 md:p-7 bg-[#FAF6EE] border border-[#6B46C1]/15 rounded-2xl"
    >
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-[#6B46C1] text-white flex items-center justify-center flex-shrink-0 shadow-sm">
          <HelpCircle className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <h2 className="font-serif text-2xl sm:text-3xl text-[#2C2C2C] leading-tight">
            Need a hand?
          </h2>
          <p className="text-sm text-[#6B705C] mt-1">
            Every feature is documented — uploads, fanfic refresh, smart shelves, AO3 filters, backups, the lot. Start anywhere or open the full guide.
          </p>
        </div>
      </div>

      <ul className="space-y-1 mb-5" data-testid="dashboard-help-quick-links">
        {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex items-center gap-2 px-2 py-1.5 -mx-2 rounded-lg text-sm text-[#2C2C2C] hover:bg-[#EDE7FB] hover:text-[#6B46C1] transition-colors"
            >
              <Icon className="w-4 h-4 text-[#6B46C1]" />
              <span className="flex-1">{label}</span>
              <ArrowRight className="w-3.5 h-3.5 opacity-50" />
            </Link>
          </li>
        ))}
      </ul>

      <Link
        to="/help"
        data-testid="dashboard-help-open-btn"
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold bg-[#6B46C1] text-white hover:bg-[#553397] transition-colors"
      >
        <HelpCircle className="w-4 h-4" /> Open the help guide
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </section>
  );
}
