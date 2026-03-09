import type { HttpTransport } from "../http";
import type { ApiResponse } from "../types/common";
import type { NoteResponse, ThesisFrontmatter, TradeStatsResponse, SearchResult, GraphResponse, CreateThesisRequest, CreateTradeRequest } from "../types/notes";

export class NotesRouter {
  constructor(private http: HttpTransport) {}

  async listNotes(): Promise<ApiResponse<NoteResponse[]>> {
    return this.http.request<NoteResponse[]>("/api/notes");
  }

  async getNote(name: string): Promise<ApiResponse<NoteResponse>> {
    return this.http.request<NoteResponse>(`/api/notes/${encodeURIComponent(name)}`);
  }

  async saveNote(name: string, content: string): Promise<ApiResponse<NoteResponse>> {
    return this.http.request<NoteResponse>(`/api/notes/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: { content },
    });
  }

  async searchNotes(query: string): Promise<ApiResponse<SearchResult[]>> {
    return this.http.request<SearchResult[]>(`/api/notes/search?query=${encodeURIComponent(query)}`);
  }

  async getTheses(): Promise<ApiResponse<NoteResponse[]>> {
    return this.http.request<NoteResponse[]>("/api/theses");
  }

  async createThesis(request: CreateThesisRequest): Promise<ApiResponse<NoteResponse>> {
    return this.http.request<NoteResponse>("/api/theses", {
      method: "POST",
      body: request,
    });
  }

  async getTrades(): Promise<ApiResponse<NoteResponse[]>> {
    return this.http.request<NoteResponse[]>("/api/trades");
  }

  async createTrade(request: CreateTradeRequest): Promise<ApiResponse<NoteResponse>> {
    return this.http.request<NoteResponse>("/api/trades", {
      method: "POST",
      body: request,
    });
  }

  async getTradeStats(): Promise<ApiResponse<TradeStatsResponse>> {
    return this.http.request<TradeStatsResponse>("/api/trades/stats");
  }

  async getGraph(): Promise<ApiResponse<GraphResponse>> {
    return this.http.request<GraphResponse>("/api/notes/graph");
  }
}
