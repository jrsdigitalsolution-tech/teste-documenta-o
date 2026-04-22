// Configuração Imutável do Supabase
const supabaseUrl = 'https://clbpujmdjbywbuevhyhg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsYnB1am1kamJ5d2J1ZXZoeWhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyOTA3NTUsImV4cCI6MjA4OTg2Njc1NX0.3vwMm8mLEcg9nPzH2uyrB65mzxN_NMvvaLSn2OxKAxo';

let supabaseClient = null;

try {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey, {
    db: { schema: 'documentos' }
  });
} catch (error) {
  console.error("Erro crítico ao inicializar Supabase:", error);
}

// Inicialização do Alpine.js
document.addEventListener('alpine:init', () => {
  Alpine.data('dashboard', () => ({
    documentos: [],
    notificacoes: [],
    loading: false,
    notificationsLoading: false,
    errorMessage: '',
    notificationsErrorMessage: '',
    search: '',
    statusFilter: '',
    categoriaFilter: '',
    selected: null,
    showExportModal: false,
    showNotificationsPanel: false,
    notificationsCount: 0,

    async init() {
      this.$watch('selected', () => this.atualizarBloqueioScroll());
      this.$watch('showExportModal', () => this.atualizarBloqueioScroll());
      this.$watch('showNotificationsPanel', () => this.atualizarBloqueioScroll());

      await this.carregar();
    },

    atualizarBloqueioScroll() {
      this.toggleScrollLock(!!(this.selected || this.showExportModal || this.showNotificationsPanel));
    },

    toggleScrollLock(isLocked) {
      if (isLocked) document.body.classList.add('overflow-hidden');
      else document.body.classList.remove('overflow-hidden');
    },

    notificationsSinceIso() {
      const base = this.todayDate();
      base.setMonth(base.getMonth() - 3);
      base.setHours(0, 0, 0, 0);
      return base.toISOString();
    },

    async sincronizarNotificacoes() {
      if (!supabaseClient) return null;

      try {
        this.notificationsErrorMessage = '';

        const { data, error } = await supabaseClient.rpc('sincronizar_notificacoes_documentos');
        if (error) throw error;

        return data || null;
      } catch (e) {
        console.error('Falha ao sincronizar notificações:', e.message);
        this.notificationsErrorMessage = e.message;
        return null;
      }
    },

    async carregarNotificacoes() {
      if (!supabaseClient) return;

      this.notificationsLoading = true;

      try {
        const { data, error } = await supabaseClient
          .from('notificacoes_documentos')
          .select('id, documento_id, apelido, documento, categoria, tipo_evento, status_anterior, status_novo, dias_restantes, vencimento, renova_antes, data_sugerida_renovacao, data_evento')
          .gte('data_evento', this.notificationsSinceIso())
          .order('data_evento', { ascending: false });

        if (error) throw error;

        this.notificacoes = data || [];
        this.notificationsCount = this.notificacoes.length;
      } catch (e) {
        console.error('Falha ao carregar notificações:', e.message);
        this.notificationsErrorMessage = e.message;
      } finally {
        this.notificationsLoading = false;
      }
    },

    async toggleNotificationsPanel() {
      if (this.showNotificationsPanel) {
        this.showNotificationsPanel = false;
        return;
      }

      this.showNotificationsPanel = true;
      await this.carregarNotificacoes();
    },

    closeNotificationsPanel() {
      this.showNotificationsPanel = false;
    },

    parseDate(dateValue) {
      if (!dateValue) return null;

      const raw = String(dateValue).trim();
      if (!raw) return null;
      if (raw.includes('2999')) return new Date(2999, 0, 1);

      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      }

      const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (brMatch) {
        return new Date(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1]));
      }

      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) return null;

      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    },

    parseDateTime(dateValue) {
      if (!dateValue) return null;

      const parsed = new Date(dateValue);
      if (Number.isNaN(parsed.getTime())) return null;

      return parsed;
    },

    todayDate() {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    },

    diffInDays(fromDate, toDate) {
      if (!(fromDate instanceof Date) || Number.isNaN(fromDate.getTime())) return null;
      if (!(toDate instanceof Date) || Number.isNaN(toDate.getTime())) return null;

      const oneDay = 24 * 60 * 60 * 1000;
      return Math.round((toDate.getTime() - fromDate.getTime()) / oneDay);
    },

    getDiasRestantes(doc) {
      if (!doc) return null;

      const valor = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      if (valor == null || valor === '') return null;

      const numero = Number(valor);
      return Number.isNaN(numero) ? null : numero;
    },

    getStatusPrazo(doc) {
      if (!doc) return '';

      return doc.status_prazo || doc.statusPrazo || '';
    },

    calcularStatusFallback(doc) {
      if (!doc) return 'em_dia';

      const vencimento = this.parseDate(doc.vencimento);
      const dataSugerida = this.parseDate(doc.data_sugerida_renovacao || doc.dataSugeridaRenovacao);
      const hoje = this.todayDate();

      if (vencimento && vencimento.getFullYear() === 2999) return 'em_dia';
      if (vencimento && hoje > vencimento) return 'vencido';
      if (dataSugerida && hoje >= dataSugerida) return 'vence_em_breve';

      const dias = this.getDiasRestantes(doc);
      if (dias != null) {
        if (dias < 0) return 'vencido';
        if (dias <= 90) return 'vence_em_breve';
      }

      return 'em_dia';
    },

    normalizarDocumento(doc) {
      const documento = { ...doc };
      const vencimentoTexto = documento.vencimento != null ? String(documento.vencimento) : '';
      const statusAtual = this.getStatusPrazo(documento);
      const dias = this.getDiasRestantes(documento);

      documento.is_vitalicio = vencimentoTexto.includes('2999');

      if (documento.is_vitalicio) {
        documento.status_prazo = 'em_dia';
      } else if (statusAtual) {
        documento.status_prazo = statusAtual;
      } else {
        documento.status_prazo = this.calcularStatusFallback(documento);
      }

      if (dias != null) {
        documento.dias_restantes = dias;
      }

      return documento;
    },

    async carregar() {
      this.loading = true;
      this.errorMessage = '';

      try {
        if (!supabaseClient) throw new Error("Cliente Supabase não configurado.");

        await this.sincronizarNotificacoes();

        const { data, error } = await supabaseClient
          .from('vw_documentos_status')
          .select('*');

        if (error) throw error;

        this.documentos = (data || []).map((doc) => this.normalizarDocumento(doc));
        await this.carregarNotificacoes();
      } catch (e) {
        console.error('Falha na comunicação com Banco de Dados:', e.message);
        this.errorMessage = e.message;
      } finally {
        this.loading = false;
      }
    },

    limparFiltros() {
      this.search = '';
      this.statusFilter = '';
      this.categoriaFilter = '';
    },

    // --- MOTOR DE EXPORTAÇÃO CSV ---
    exportarCSV() {
      const docs = this.filteredDocumentos;
      if (docs.length === 0) {
        alert("Nenhum documento encontrado com os filtros atuais.");
        return;
      }

      let csv = "Apelido;Orgao Expedidor;Categoria;Vencimento;Dias Restantes;Status\n";

      docs.forEach(doc => {
        const apelido = doc.apelido || '-';
        const orgao = doc.orgao_expeditor || doc.orgaoExpeditor || '-';
        const categoria = doc.categoria || '-';
        const vencimento = this.formatDate(doc.vencimento);
        const dias = doc.is_vitalicio ? 'Vitalicio' : (doc.dias_restantes != null ? doc.dias_restantes : (doc.diasRestantes != null ? doc.diasRestantes : '-'));
        const status = this.labelStatus(doc);

        const linha = [apelido, orgao, categoria, vencimento, dias, status]
          .map(campo => '"' + String(campo).split('"').join('""') + '"')
          .join(';');

        csv += linha + "\n";
      });

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Controle_Documentos_${new Date().toISOString().split('T')[0]}.csv`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      this.showExportModal = false;
    },

    // --- MOTOR DE EXPORTAÇÃO WHATSAPP ---
    exportarWhatsApp() {
      const categorias = this.resumoCategorias;
      if (categorias.length === 0) {
        alert("Nenhum dado encontrado para partilhar.");
        return;
      }

      let textoRelatorio = "*Resumo de Documentações por Categoria* 📊\n\n";

      categorias.forEach(cat => {
        textoRelatorio += `*${cat.categoria}*\n`;
        textoRelatorio += `🔴 Atrasado: ${cat.vencido} | 🟡 Breve: ${cat.venceEmBreve} | 🟢 OK: ${cat.emDia}\n\n`;
      });

      textoRelatorio += `_Total filtrado: ${this.stats.total} documento(s)_`;

      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(textoRelatorio)}`, '_blank');
      this.showExportModal = false;
    },

    scrollToLista(status) {
      this.statusFilter = status;
      document.getElementById('documentos-section').scrollIntoView({ behavior: 'smooth' });
    },

    // --- LÓGICA REATIVA DE FILTRAGEM ---
    get filteredDocumentos() {
      const pesos = { 'vencido': 1, 'vence_em_breve': 2, 'em_dia': 3 };

      return this.documentos.filter(doc => {
        const textoBusca = (doc.apelido || doc.documento || '') + ' ' + (doc.orgao_expeditor || doc.orgaoExpeditor || '') + ' ' + (doc.categoria || '') + ' ' + (doc.tipo_doc || doc.tipo_documento || doc.tipoDocumento || '');
        const bateBusca = textoBusca.toLowerCase().includes(this.search.toLowerCase());
        const status = this.getStatusPrazo(doc);
        const bateStatus = !this.statusFilter || status === this.statusFilter;
        const bateCategoria = !this.categoriaFilter || doc.categoria === this.categoriaFilter;
        return bateBusca && bateStatus && bateCategoria;
      }).sort((a, b) => {
        const statusA = this.getStatusPrazo(a);
        const statusB = this.getStatusPrazo(b);
        const pesoA = pesos[statusA] || 4;
        const pesoB = pesos[statusB] || 4;

        if (pesoA !== pesoB) return pesoA - pesoB;

        const getDias = (d) => d.is_vitalicio ? 999999 : (this.getDiasRestantes(d) != null ? this.getDiasRestantes(d) : 999999);
        return getDias(a) - getDias(b);
      });
    },

    get stats() {
      const listaBase = this.filteredDocumentos;
      return {
        total: listaBase.length,
        emDia: listaBase.filter(d => this.getStatusPrazo(d) === 'em_dia').length,
        venceEmBreve: listaBase.filter(d => this.getStatusPrazo(d) === 'vence_em_breve').length,
        vencido: listaBase.filter(d => this.getStatusPrazo(d) === 'vencido').length
      };
    },

    get categoriasUnicas() {
      return [...new Set(this.documentos.map(d => d.categoria).filter(Boolean))].sort();
    },

    get resumoCategorias() {
      const mapa = {};

      this.filteredDocumentos.forEach(doc => {
        const categoria = doc.categoria || 'Sem categoria';
        const status = this.getStatusPrazo(doc);

        if (!mapa[categoria]) {
          mapa[categoria] = { categoria, total: 0, emDia: 0, venceEmBreve: 0, vencido: 0 };
        }

        mapa[categoria].total++;
        if (status === 'em_dia') mapa[categoria].emDia++;
        if (status === 'vence_em_breve') mapa[categoria].venceEmBreve++;
        if (status === 'vencido') mapa[categoria].vencido++;
      });

      return Object.values(mapa).sort((a, b) => b.total - a.total);
    },

    labelStatusValue(status) {
      if (status === 'vencido') return 'Vencido';
      if (status === 'vence_em_breve') return 'Prestes a vencer';
      if (status === 'em_dia') return 'Em dia';
      return '-';
    },

    textoNotificacaoRapida(item) {
      if (!item) return '-';
      if (item.tipo_evento === 'vence_hoje') return 'Hoje é o último dia para renovação deste documento.';

      const statusAnterior = this.labelStatusValue(item.status_anterior);
      const statusNovo = this.labelStatusValue(item.status_novo);

      if (statusAnterior !== '-' && statusNovo !== '-' && statusAnterior !== statusNovo) {
        return `Mudou de ${statusAnterior} para ${statusNovo}.`;
      }

      if (statusNovo !== '-') {
        return `Status alterado para ${statusNovo}.`;
      }

      return 'O status deste documento foi atualizado.';
    },

    async openNotificationDocument(item) {
      if (!item || !item.documento_id) return;

      let documento = this.documentos.find((doc) => String(doc.id) === String(item.documento_id));

      if (!documento && supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('vw_documentos_status')
            .select('*')
            .eq('id', item.documento_id)
            .maybeSingle();

          if (error) throw error;
          if (data) documento = this.normalizarDocumento(data);
        } catch (e) {
          console.error('Falha ao abrir documento a partir da notificação:', e.message);
        }
      }

      if (!documento) return;

      this.closeNotificationsPanel();
      this.selected = documento;
    },

    // --- HELPERS DE UI RESPONSIVA ---
    labelStatus(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';

      const status = this.getStatusPrazo(doc);
      if (status === 'vencido') return 'Vencido';
      if (status === 'vence_em_breve') return 'Prestes a vencer';
      return 'Em dia';
    },

    badgeClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'bg-blue-100 text-blue-700';

      const status = this.getStatusPrazo(doc);
      if (status === 'vencido') return 'bg-rose-100 text-rose-700';
      if (status === 'vence_em_breve') return 'bg-amber-100 text-amber-700';
      return 'bg-emerald-100 text-emerald-700';
    },

    urgenciaDiasClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'text-blue-700 font-medium';

      const status = this.getStatusPrazo(doc);
      if (status === 'vencido') return 'text-rose-700 font-bold';
      if (status === 'vence_em_breve') return 'text-amber-700 font-bold';
      return 'text-slate-800 font-medium';
    },

    formatDias(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';

      const dias = this.getDiasRestantes(doc);
      return dias != null ? dias : '-';
    },

    formatDiasTexto(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício (Não vence)';

      const dias = this.getDiasRestantes(doc);
      if (dias == null) return '-';
      if (dias === 0) return 'Vence hoje';
      if (dias < 0) return `${Math.abs(dias)} dia(s) em atraso`;
      return `${dias} dias restantes`;
    },

    formatDate(date) {
      if (!date) return '-';
      if (String(date).includes('2999')) return 'Vitalício';

      const partes = String(date).split('-');
      if (partes.length === 3) return `${partes[2].slice(0, 2)}/${partes[1]}/${partes[0]}`;

      const parsed = this.parseDate(date);
      if (!parsed) return '-';

      const dia = String(parsed.getDate()).padStart(2, '0');
      const mes = String(parsed.getMonth() + 1).padStart(2, '0');
      const ano = parsed.getFullYear();
      return `${dia}/${mes}/${ano}`;
    }
  }));
});
