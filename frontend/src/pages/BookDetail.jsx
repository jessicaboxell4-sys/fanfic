import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, API } from "../lib/api";
import Navbar from "../components/Navbar";
import { ArrowLeft, Download, Trash2, Sparkles, Book, Edit3, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = ["Fanfiction", "Original Fiction", "Non-fiction", "Unclassified"];

export default function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reclassifying, setReclassifying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editCategory, setEditCategory] = useState("");
  const [editFandom, setEditFandom] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get(`/books/${id}`);
      setBook(data);
      setEditCategory(data.category);
      setEditFandom(data.fandom || "");
    } catch (e) {
      toast.error("Couldn't load book");
      navigate("/library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const reclassify = async () => {
    setReclassifying(true);
    try {
      const { data } = await api.post(`/books/${id}/reclassify`, { use_ai: true });
      toast.success(`Reclassified by AI: ${data.category}${data.fandom ? ` · ${data.fandom}` : ""}`);
      await load();
    } catch (e) {
      toast.error("Reclassification failed");
    } finally {
      setReclassifying(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this book from your library?")) return;
    try {
      await api.delete(`/books/${id}`);
      toast.success("Removed");
      navigate("/library");
    } catch (e) {
      toast.error("Couldn't delete");
    }
  };

  const saveEdit = async () => {
    try {
      await api.patch(`/books/${id}`, { category: editCategory, fandom: editFandom || null });
      toast.success("Updated");
      setEditing(false);
      await load();
    } catch (e) {
      toast.error("Couldn't update");
    }
  };

  const download = () => {
    window.open(`${API}/books/${id}/download`, "_blank");
  };

  const downloadLinks = () => {
    window.open(`${API}/books/${id}/links`, "_blank");
  };

  if (loading || !book) {
    return (
      <div className="min-h-screen bg-paper">
        <Navbar />
        <div className="text-center py-20 text-[#6B705C]">Loading…</div>
      </div>
    );
  }

  const coverUrl = book.has_cover
    ? `${process.env.REACT_APP_BACKEND_URL}/api/books/${book.book_id}/cover`
    : null;

  return (
    <div className="min-h-screen bg-paper">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 md:px-8 py-8 md:py-12 fade-in">
        <button
          onClick={() => navigate("/library")}
          className="flex items-center gap-2 text-sm text-[#6B705C] hover:text-[#2C2C2C] mb-8"
          data-testid="back-to-library"
        >
          <ArrowLeft className="w-4 h-4" /> Back to library
        </button>

        <div className="grid md:grid-cols-[260px_1fr] gap-10">
          <div>
            <div className="aspect-[2/3] rounded-2xl overflow-hidden shelf-card">
              {coverUrl ? (
                <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
              ) : (
                <div className="book-spine w-full h-full">
                  <div>
                    <Book className="w-10 h-10 mx-auto mb-3 opacity-80" />
                    <p className="text-lg">{book.title}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3A5A40] mb-2">
              {book.author}
            </p>
            <h1 className="font-serif text-4xl sm:text-5xl text-[#2C2C2C] leading-tight mb-4" data-testid="book-detail-title">
              {book.title}
            </h1>

            <div className="flex flex-wrap gap-2 mb-6">
              <span className={
                book.category === "Fanfiction" ? "badge-fandom" :
                book.category === "Original Fiction" ? "badge-original" :
                book.category === "Non-fiction" ? "badge-nonfic" : "badge-unclassified"
              }>
                {book.category}
              </span>
              {book.fandom && <span className="badge-fandom">{book.fandom}</span>}
              <span className="text-xs text-[#6B705C] px-2 py-1">
                via {book.classifier} · {Math.round(book.confidence * 100)}% confident
              </span>
            </div>

            {book.description && (
              <p className="text-[#2C2C2C] leading-relaxed mb-8 max-h-60 overflow-y-auto pr-2" data-testid="book-detail-description">
                {book.description}
              </p>
            )}

            {editing ? (
              <div className="shelf-card p-5 mb-6">
                <p className="text-sm font-semibold text-[#2C2C2C] mb-3">Edit classification</p>
                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-[#6B705C] mb-1 block">Category</label>
                    <select
                      data-testid="edit-category"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[#6B705C] mb-1 block">Fandom (optional)</label>
                    <input
                      data-testid="edit-fandom"
                      type="text"
                      placeholder="e.g., Harry Potter"
                      value={editFandom}
                      onChange={(e) => setEditFandom(e.target.value)}
                      className="w-full bg-white border border-[#E8E6E1] rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button data-testid="edit-save" onClick={saveEdit} className="btn-primary text-sm">Save</button>
                  <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  data-testid="download-book-btn"
                  onClick={download}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Download className="w-4 h-4" /> Download EPUB
                </button>
                <button
                  data-testid="download-links-btn"
                  onClick={downloadLinks}
                  className="btn-secondary flex items-center gap-2 text-sm"
                  title="Save every URL from this EPUB to a .txt file"
                >
                  <LinkIcon className="w-4 h-4" />
                  Save links (.txt){typeof book.links_count === "number" ? ` · ${book.links_count}` : ""}
                </button>
                <button
                  data-testid="reclassify-btn"
                  onClick={reclassify}
                  disabled={reclassifying}
                  className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {reclassifying ? "Asking AI…" : "Reclassify with AI"}
                </button>
                <button
                  data-testid="edit-btn"
                  onClick={() => setEditing(true)}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Edit3 className="w-4 h-4" /> Edit
                </button>
                <button
                  data-testid="delete-btn"
                  onClick={remove}
                  className="text-[#D9534F] hover:bg-[#D9534F]/10 px-4 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              </div>
            )}

            <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Meta label="File" value={book.filename} />
              <Meta label="Size" value={`${(book.size_bytes / 1024).toFixed(0)} KB`} />
              <Meta label="Language" value={book.language || "—"} />
              {book.publisher && <Meta label="Publisher" value={book.publisher} />}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function Meta({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-[#6B705C] font-semibold mb-1">{label}</p>
      <p className="text-[#2C2C2C] break-words">{value}</p>
    </div>
  );
}
