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
    loading: false,
    errorMessage: '',
    search: '',
    statusFilter: '',
    categoriaFilter: '',
    selected: null,
    showExportModal: false,

    async init() {
      // Bloqueia o scroll da página quando qualquer modal (detalhes ou exportação) está aberto
      this.$watch('selected', (val) => this.toggleScrollLock(val || this.showExportModal));
      this.$watch('showExportModal', (val) => this.toggleScrollLock(val || this.selected));

      await this.carregar();
    },

    toggleScrollLock(isLocked) {
      if (isLocked) document.body.classList.add('overflow-hidden');
      else document.body.classList.remove('overflow-hidden');
    },

    getHojeNormalizado() {
      const agora = new Date();
      return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
    },

    parseDateValue(dateValue) {
      if (!dateValue) return null;

      const valor = String(dateValue).trim();
      if (!valor) return null;

      const match = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const ano = Number(match[1]);
        const mes = Number(match[2]) - 1;
        const dia = Number(match[3]);
        return new Date(Date.UTC(ano, mes, dia));
      }

      const parsed = new Date(valor);
      if (Number.isNaN(parsed.getTime())) return null;

      return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
    },

    formatDateToISO(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      const ano = date.getUTCFullYear();
      const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
      const dia = String(date.getUTCDate()).padStart(2, '0');
      return `${ano}-${mes}-${dia}`;
    },

    diffInDays(startDate, endDate) {
      if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return null;
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return null;

      const millisecondsPerDay = 24 * 60 * 60 * 1000;
      return Math.floor((endDate.getTime() - startDate.getTime()) / millisecondsPerDay);
    },

    getDiasAntecedencia(doc, vencimentoDate) {
      const renovaAntesRaw = doc.renova_antes != null ? doc.renova_antes : doc.renovaAntes;
      const renovaAntes = Number(renovaAntesRaw);

      if (Number.isFinite(renovaAntes) && renovaAntes >= 0) {
        return renovaAntes;
      }

      const dataSugerida = this.parseDateValue(doc.data_sugerida_renovacao || doc.dataSugeridaRenovacao);
      if (dataSugerida && vencimentoDate) {
        const diferenca = this.diffInDays(dataSugerida, vencimentoDate);
        if (Number.isFinite(diferenca) && diferenca >= 0) {
          return diferenca;
        }
      }

      return 90;
    },

    getDataInicioAlerta(doc, vencimentoDate, diasAntecedencia) {
      const dataSugerida = this.parseDateValue(doc.data_sugerida_renovacao || doc.dataSugeridaRenovacao);
      if (dataSugerida) return dataSugerida;

      if (!vencimentoDate || !Number.isFinite(diasAntecedencia)) return null;

      const millisecondsPerDay = 24 * 60 * 60 * 1000;
      return new Date(vencimentoDate.getTime() - (diasAntecedencia * millisecondsPerDay));
    },

    normalizarDocumentoPrazo(doc) {
      const vencimentoRaw = doc.vencimento;
      const isVitalicio = Boolean(vencimentoRaw && String(vencimentoRaw).includes('2999'));
      const vencimentoDate = this.parseDateValue(vencimentoRaw);
      const hoje = this.getHojeNormalizado();

      doc.is_vitalicio = isVitalicio;

      if (isVitalicio) {
        doc.status_prazo = 'em_dia';
        return doc;
      }

      const diasRestantesCalculados = vencimentoDate ? this.diffInDays(hoje, vencimentoDate) : null;
      const diasRestantesOriginais = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      const diasRestantesNormalizados = Number.isFinite(diasRestantesCalculados) ? diasRestantesCalculados : diasRestantesOriginais;

      if (diasRestantesNormalizados != null) {
        doc.dias_restantes = diasRestantesNormalizados;
        doc.diasRestantes = diasRestantesNormalizados;
      }

      const diasAntecedencia = this.getDiasAntecedencia(doc, vencimentoDate);
      if (Number.isFinite(diasAntecedencia)) {
        doc.renova_antes = diasAntecedencia;
        doc.renovaAntes = diasAntecedencia;
      }

      const dataInicioAlerta = this.getDataInicioAlerta(doc, vencimentoDate, diasAntecedencia);
      if (dataInicioAlerta && !doc.data_sugerida_renovacao && !doc.dataSugeridaRenovacao) {
        const dataISO = this.formatDateToISO(dataInicioAlerta);
        doc.data_sugerida_renovacao = dataISO;
        doc.dataSugeridaRenovacao = dataISO;
      }

      if (Number.isFinite(diasRestantesCalculados)) {
        if (diasRestantesCalculados < 0) {
          doc.status_prazo = 'vencido';
        } else if (dataInicioAlerta && hoje.getTime() >= dataInicioAlerta.getTime()) {
          doc.status_prazo = 'vence_em_breve';
        } else {
          doc.status_prazo = 'em_dia';
        }
        return doc;
      }

      if (diasRestantesOriginais != null) {
        if (diasRestantesOriginais < 0) doc.status_prazo = 'vencido';
        else if (diasRestantesOriginais <= diasAntecedencia) doc.status_prazo = 'vence_em_breve';
        else doc.status_prazo = 'em_dia';
      }

      return doc;
    },

    async carregar() {
      this.loading = true;
      this.errorMessage = '';
      try {
        if (!supabaseClient) throw new Error("Cliente Supabase não configurado.");

        const { data, error } = await supabaseClient.from('vw_documentos_status').select('*');
        if (error) throw error;

        // Motor de Regras Matemáticas Avançadas
        this.documentos = (data || []).map(doc => this.normalizarDocumentoPrazo(doc));

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
        const status = doc.status_prazo || doc.statusPrazo;
        const bateStatus = !this.statusFilter || status === this.statusFilter;
        const bateCategoria = !this.categoriaFilter || doc.categoria === this.categoriaFilter;
        return bateBusca && bateStatus && bateCategoria;
      }).sort((a, b) => {
        const statusA = a.status_prazo || a.statusPrazo;
        const statusB = b.status_prazo || b.statusPrazo;
        const pesoA = pesos[statusA] || 4;
        const pesoB = pesos[statusB] || 4;

        if (pesoA !== pesoB) return pesoA - pesoB;

        const getDias = (d) => d.is_vitalicio ? 999999 : (d.dias_restantes != null ? d.dias_restantes : (d.diasRestantes != null ? d.diasRestantes : 999999));
        return getDias(a) - getDias(b);
      });
    },

    get stats() {
      const listaBase = this.filteredDocumentos; // Usa a lista já filtrada para bater com a exportação
      return {
        total: listaBase.length,
        emDia: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'em_dia').length,
        venceEmBreve: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'vence_em_breve').length,
        vencido: listaBase.filter(d => (d.status_prazo || d.statusPrazo) === 'vencido').length
      };
    },

    get categoriasUnicas() {
      return [...new Set(this.documentos.map(d => d.categoria).filter(Boolean))].sort();
    },

    get resumoCategorias() {
      const mapa = {};

      this.filteredDocumentos.forEach(doc => {
        const categoria = doc.categoria || 'Sem categoria';
        const status = doc.status_prazo || doc.statusPrazo;

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

    // --- HELPERS DE UI RESPONSIVA ---
    labelStatus(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';
      const status = doc.status_prazo || doc.statusPrazo;
      if (status === 'vencido') return 'Vencido';
      if (status === 'vence_em_breve') return 'Prestes a vencer';
      return 'Em dia';
    },

    badgeClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'bg-blue-100 text-blue-700';
      const status = doc.status_prazo || doc.statusPrazo;
      if (status === 'vencido') return 'bg-rose-100 text-rose-700';
      if (status === 'vence_em_breve') return 'bg-amber-100 text-amber-700';
      return 'bg-emerald-100 text-emerald-700';
    },

    urgenciaDiasClass(doc) {
      if (!doc) return '';
      if (doc.is_vitalicio) return 'text-blue-700 font-medium';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      if (dias == null) return '';
      if (dias < 0) return 'text-rose-700 font-bold';
      if (dias <= 90) return 'text-amber-700 font-bold';
      return 'text-slate-800 font-medium';
    },

    formatDias(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      return dias != null ? dias : '-';
    },

    formatDiasTexto(doc) {
      if (!doc) return '-';
      if (doc.is_vitalicio) return 'Vitalício (Não vence)';
      const dias = doc.dias_restantes != null ? doc.dias_restantes : doc.diasRestantes;
      if (dias == null) return '-';
      if (dias < 0) return `${Math.abs(dias)} dia(s) em atraso`;
      if (dias === 0) return 'Vence hoje';
      return `${dias} dias restantes`;
    },

    formatDate(date) {
      if (!date) return '-';

      const valor = String(date);
      if (valor.includes('2999')) return 'Vitalício';

      const parsed = this.parseDateValue(valor);
      if (!parsed) return '-';

      const dia = String(parsed.getUTCDate()).padStart(2, '0');
      const mes = String(parsed.getUTCMonth() + 1).padStart(2, '0');
      const ano = parsed.getUTCFullYear();

      return `${dia}/${mes}/${ano}`;
    }
  }));
});
