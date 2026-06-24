import React from "react";
import { Link } from "react-router-dom";
import { Heart } from "lucide-react";

/**
 * Site footer with legal + contact + repo links.
 *
 * Rendered on public-facing pages (Landing, Login, Help, Privacy,
 * Terms).  Keep it short — three small columns, no newsletter
 * signup, no social-icon row, no cookie banner.  The whole point
 * of Shelfsort's aesthetic is "calm reading nook," and that
 * extends to the footer.
 *
 * If you add a new top-level public route that someone might
 * land on from search, please add it to the "About" column so
 * it's reachable from the bottom of every page.
 */
export default function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer
      data-testid="site-footer"
      className="mt-16 border-t border-[#E5DDC5] bg-[#FBFAF6]"
    >
      <div className="max-w-6xl mx-auto px-6 md:px-8 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <p className="font-serif text-xl text-[#2C2C2C]">Shelfsort</p>
            <p className="mt-2 text-[12px] text-[#6B705C] leading-relaxed">
              A quieter way to organize ebooks. AI-categorized, ad-free,
              made for the AO3 → re-read pile.
            </p>
          </div>

          {/* About */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C] font-semibold mb-3">
              About
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/help"
                  data-testid="footer-link-help"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Help &amp; FAQ
                </Link>
              </li>
              <li>
                <Link
                  to="/help/kindle-import"
                  data-testid="footer-link-kindle-import"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Import from Kindle
                </Link>
              </li>
              <li>
                <Link
                  to="/changelog"
                  data-testid="footer-link-changelog"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  What&rsquo;s new
                </Link>
              </li>
              <li>
                <Link
                  to="/explore/covers"
                  data-testid="footer-link-covers"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Cover archive
                </Link>
              </li>
              <li>
                <Link
                  to="/suggestions"
                  data-testid="footer-link-suggestions"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Suggestions board
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C] font-semibold mb-3">
              Legal
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/privacy"
                  data-testid="footer-link-privacy"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link
                  to="/terms"
                  data-testid="footer-link-terms"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Terms of service
                </Link>
              </li>
              <li>
                <Link
                  to="/rules"
                  data-testid="footer-link-rules"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  Community rules
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#6B705C] font-semibold mb-3">
              Contact
            </p>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="mailto:hello@shelfsort.com"
                  data-testid="footer-link-email"
                  className="text-[#2C2C2C] hover:text-[#6B46C1] hover:underline"
                >
                  hello@shelfsort.com
                </a>
              </li>
              <li className="text-[12px] text-[#6B705C]">
                A real human reads every reply.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-[#E5DDC5] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[12px] text-[#6B705C]">
          <p>&copy; {year} Shelfsort. Made with <Heart className="w-3 h-3 inline-block text-[#6B46C1]" /> for readers.</p>
          <p className="font-mono">v.{(process.env.REACT_APP_VERSION || "dev").slice(0, 7)}</p>
        </div>
      </div>
    </footer>
  );
}
