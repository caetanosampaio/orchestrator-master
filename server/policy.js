// Política de execução e aprovações (M9). Regras PURAS e centralizadas: nada aqui executa processos, grava o banco nem confia em quem pediu a ação.
//
// A política depende do PERFIL de permissão do workspace (exec-profile.js, `profileOf(workspace)`; só o usuário muda o perfil, nunca o Planner, o chat nem o Maestro):
//   default : a barreira REAL é o que a CLI do Executor recebe (`acceptEdits` + `--allowedTools` com a lista pré-aprovada + `--disallowedTools` da rede; exec-profile.js). Esta política é
//             só aviso antecipado: nega, ANTES de gastar uma execução, o que a CLI negaria de qualquer jeito (instalar, push/deploy, commit, git que descarta trabalho, curl/rm -rf...).
//   bypass  : o Executor roda com `bypassPermissions`: NENHUMA barreira da CLI. A política vira SÓ aviso antecipado por heurística de TEXTO sobre o que a etapa DECLARA; ela NÃO é
//             barreira (o agente pode fazer o que o texto não menciona, ou descrever de outro jeito). Pede aprovação humana para o que é arriscado e nega só o intocável.
// Nos DOIS perfis: arquivos sensíveis/de segredo e sobrescrita integral exigem aprovação humana; .git, o estado do orquestrador e ação não classificável são sempre negados.
//
// Decisões, da menos para a mais restritiva (a pior vence):
//   allow             : ler/criar/editar arquivos comuns do workspace (e, em bypass, shell/rede/commit comuns).
//   approval_required : manifestos, CI, Docker, hooks, segredos, sobrescrita integral (os dois perfis). Só em bypass: caminho fora do workspace e instalar dependências, git destrutivo e
//                       efeitos externos (push, deploy, publicar). Instalar e sobrescrita aceitam autorização prévia no plano; o resto, só aprovação individual na hora (preAuthProblem).
//   deny              : sempre .git, estado do orquestrador e ação não classificável; no perfil padrão também o que a CLI não permite (ver acima) e caminhos fora do workspace.
//
// Limite honesto: a política avalia o ESCOPO DECLARADO da etapa (título, instruções, critérios e expectedFiles), não cada chamada de ferramenta do Executor durante a
// execução (a CLI não oferece esse gancho aqui). As regras de texto têm falsos positivos e negativos (veja os testes); o scope.js confere depois o que mudou de fato.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { safeRelPath, isGitName } from './evidence.js';
import { profileOf } from './exec-profile.js';

export const POLICY_VERSION = 1;
export const DECISIONS = ['allow', 'approval_required', 'deny'];
const RANK = { allow: 0, approval_required: 1, deny: 2 };
const clip = (s, n) => String(s ?? '').slice(0, n);

const SECRET_FILE = /(^|\/)(\.env(\.[^/]+)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.[a-z]+)?|secrets?\.(json|ya?ml|toml|env)|[^/]+\.(pem|key|pfx|p12|keystore|jks))$/i;
const SECRET_EXAMPLE = /\.(example|sample|template|dist)$/i; // .env.example documenta variáveis, não guarda valores
const SENSITIVE_FILE = /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|Pipfile|go\.mod|Cargo\.toml|Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|\.gitlab-ci\.yml|\.gitmodules)$|(^|\/)(\.github|\.husky|\.claude|\.circleci)\//i;
/** Para o controle de escopo (scope.js): o mesmo critério da política decide o que é segredo e o que é sensível. */
export const isSecretPath = (rel) => SECRET_FILE.test(rel) && !SECRET_EXAMPLE.test(rel);
export const isSensitivePath = (rel) => SENSITIVE_FILE.test(rel);
const OUTSIDE_TEXT = /(^|[\s"'`(=])(?:[A-Za-z]:\/|\/\/|~\/|(?:\.\.\/)+|\/(?:etc|usr|var|home|root|bin|sbin|opt|tmp|Users|mnt|proc|sys|private|Library|Applications|System|Volumes)\b|%[A-Za-z_]+%|\$\{?(?:HOME|USERPROFILE)\b)/;
// Sem distinção de caixa (Windows/macOS) e com pontos/espaços finais (`.git.`, `.git /x`, equivalentes a `.git` no Windows). `.github`, `.gitignore` etc. não casam: depois de `.git` só entram [. ] e então / espaço, aspas, `)` ou fim.
const GIT_DIR_TEXT = /(^|[\s"'`(/=:,;[{|&<>])\.git[. ]*(\/|\s|$|["'`),;:?!\]}|&<>])/i; // delimitadores de texto livre: `--git-dir=.git/hooks`, `.git,`, `.git;`, `.git&&ls`
const STATE_TEXT = /(^|[\s"'`/])db\.json(\.(tmp|bak))?\b/i;
// Sobrescrita destrutiva: o ALVO precisa ser o conteúdo/arquivo inteiro. Verbos genéricos sozinhos ("substituir todo o texto X por Y", "limpar a lista") não contam.
const OVERWRITE_PATTERNS = [
  /\b(?:sobrescrev\w*|overwrit\w*)\b/i,
  /\breescrev\w*\s+(?:do\s+zero|por\s+completo|inteiramente|tudo|(?:o|a)\s+(?:arquivo|file)\s+(?:todo|inteir[oa]|por\s+completo))\b/i,
  /\bsubstitu\w*\s+(?:todo\s+(?:o\s+)?conte[uú]do|(?:o|a)\s+(?:arquivo|file)\s+(?:todo|inteir[oa]|por\s+completo|completamente)|(?:todo|inteiramente|completamente|por\s+completo)\b[^.\n]{0,20}\b(?:conte[uú]do|arquivo|file)\b)/i,
  /\b(?:rewrite|replace)\s+(?:the\s+)?(?:whole|entire|complete)\s+(?:file|content)s?\b|\brewrite\s+(?:from\s+scratch|entirely)\b/i,
  /\b(?:apag\w*|limp\w*|esvazi\w*|clear\w*|empty|wipe\w*)\s+(?:completamente\s+|por\s+completo\s+)?(?:o\s+|todo\s+o\s+|the\s+(?:whole\s+)?)?(?:conte[uú]do|content)\b/i,
];

// Contexto de uma menção a arquivo sensível. Por ORAÇÃO (separada por . ; , quebra de linha, "mas"/"porém"): só conta como alteração se houver um verbo de ESCRITA não negado e o
// arquivo não aparecer como FONTE de leitura ("conforme o package.json", "definido no package.json"). Negação antes do arquivo ("não altere", "sem tocar no") anula a menção.
// Os arquivos declarados em expectedFiles (o escopo de escrita da etapa) sempre contam. Segredos são mais estritos: ler também conta, só a negação anula.
const WRITE_VERB = /\b(?:alter\w*|edit\w*|modific\w*|atualiz\w*|adicion\w*|inclu\w*|insir\w*|cri(?:e|ar|ando|ad[oa]s?)|escrev\w*|grav\w*|remov\w*|renome\w*|troc\w*|mud(?:e|ar|ando|ad[oa]s?)|ajust\w*|configur\w*|defin(?:a|ir|indo)|reescrev\w*|sobrescrev\w*|substitu\w*|corrij\w*|corrig\w*|acrescent\w*|incremen\w*|bump\w*|upgrad\w*|updat\w*|chang\w*|add(?:ing|ed)?|modif\w*|writ\w*|creat\w*|append\w*|renam\w*|fix\w*|patch\w*|rewrit\w*|overwrit\w*)\b/gi;
const NEG_CTX = /\b(?:n[aã]o|nunca|jamais|sem|evite|evitar|proibid\w*|exceto|never|don'?t|do\s+not|without|avoid|except)\b/i;
const READ_CTX = /(?:conforme|de\s+acordo\s+com|segundo|com\s+base\s+(?:em|no|na|nos|nas)|baseand[oa]-se\s+em|a\s+partir\s+(?:d[oae]s?|de)|usando|lendo|consultando|(?:definid|descrit|declarad|listad|presente|existente|configurad)[oa]s?\s+(?:no|na|em)|according\s+to|based\s+on|as\s+defined\s+in|defined\s+in|listed\s+in)\s+(?:(?:o|a|os|as|no|na|nos|nas|do|da|dos|das)\s+)*$/i;
const CLAUSE_SPLIT = /\.(?=\s|$)|[;!?\n,]|\b(?:mas|por[eé]m|entretanto|but)\b/i; // o ponto só separa oração quando é final ("package.json" não é separado)
const clausesOf = (text) => text.split(CLAUSE_SPLIT).filter((c) => c && c.trim());
/** Há um verbo de escrita NÃO negado na oração? */
const writes = (clause) => [...clause.matchAll(WRITE_VERB)].some((v) => !NEG_CTX.test(clause.slice(0, v.index)));

// Pedidos que o perfil PADRÃO não permite (a CLI os negaria sozinha): pedir isso é pedir o impossível, e "aprovar" seria simular uma proteção. Cada item: [rótulo, regex].
// Shell genérico ("rode o comando npm test") NÃO está aqui: no perfil padrão a CLI pré-aprova testes/verificações e o resto é negado por ela; só os binários perigosos são vetados antes.
const RE_INSTALL = /\b(?:npm|pnpm|yarn|bun|pip3?|poetry|cargo)\s+(?:install|add|i|ci)\b|\binstal(?:e|ar|ação|acao)\b[^.\n]{0,30}\b(?:depend[eê]ncias?|pacotes?|packages?|dependencies)\b/i;
const RE_VCS_DESTRUCTIVE = /\bgit\s+(?:reset|clean|rebase|merge|checkout|stash)\b/i;
const RE_COMMIT = /\bgit\s+commit\b|\b(?:fazer|realizar|executar|rodar)\s+(?:o\s+|um\s+)?commit\b/i;
const RE_EXTERNAL = /\bgit\s+push\b|\bnpm\s+publish\b|\bdocker\s+push\b|\bkubectl\b|\bterraform\s+apply\b|\b(?:fazer|realizar|executar|rodar)\s+(?:o\s+|um\s+)?(?:deploy|push)\b|\bdeploy(?:ar)?\s+(?:em|para|na|no)\b|\bpublicar\b[^.\n]{0,30}\b(?:site|app|pacote|package|produ[cç][aã]o)\b|\bpublish\b/i;
const RE_SHELL_DANGER = /\b(?:curl|wget|sudo|Invoke-WebRequest|Remove-Item)\b|\brm\s+-[a-z]*[rf]|\brmdir\b|\bdel\s+\//i;
const RE_NETWORK = /\b(?:baix(?:ar|e)|download|acessar|acesse|fetch)\b[^.\n]{0,60}https?:\/\//i;
const RE_DELETE = /\b(?:apag(?:ar|ue|ando)|exclu(?:ir|a|indo)|delet(?:ar|e)|deleting)\b[^.\n]{0,25}\b(?:arquivos?|pastas?|diret[oó]rios?|files?|folders?|director(?:y|ies))\b/i;
const joinRe = (...res) => new RegExp(res.map((r) => r.source).join('|'), 'i');
const DEFAULT_DENY = [
  ['instalar dependências', RE_INSTALL, 'O perfil padrão não pré-aprova instalação de dependências: ligue o modo sem confirmação ou faça você mesmo.'],
  ['publicar, fazer deploy, commit ou push', joinRe(RE_VCS_DESTRUCTIVE, RE_COMMIT, RE_EXTERNAL)],
  ['executar comandos perigosos (curl, wget, sudo, Invoke-WebRequest, Remove-Item, rm -rf, rmdir)', RE_SHELL_DANGER],
  ['acessar a rede', RE_NETWORK],
  ['excluir arquivos ou pastas', RE_DELETE],
];
/** Manifestos e lockfiles da raiz que uma instalação de dependências altera; `dependency_install` lista os que existem e o ciclo os aceita no controle de escopo depois da aprovação. */
export const DEPENDENCY_FILES = Object.freeze(['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'requirements.txt', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'pyproject.toml', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock']);
// Caminho inválido que uma PESSOA consegue avaliar ao aprovar (absoluto, unidade, ".."); lixo (caractere de controle, curinga, comprimento) não é aprovável.
const approvableOutside = (raw) => { const s = typeof raw === 'string' ? raw.trim().replace(/\\/g, '/') : ''; return !!s && s.length <= 200 && !/[\u0000-\u001f*?<>|"]/.test(s) && (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')); }; // eslint-disable-line no-control-regex
const hasGitSegment = (raw) => typeof raw === 'string' && raw.replace(/\\/g, '/').split('/').some((x) => isGitName(x));

/** Texto (PT-BR) da política vigente para o prompt do Planner e do chat: o que é bloqueado e o que exige aprovação humana, por perfil. Só descreve; quem decide é evaluateTask. */
export function policyPromptText(profile) {
  if (profile === 'bypass') {
    return 'POLÍTICA DO SERVIDOR (fixa; você não pode alterá-la nem conceder aprovações): etapas que mexam na pasta .git, no estado interno do orquestrador ou não possam ser classificadas são BLOQUEADAS e voltam como falha; '
      + 'EXIGEM aprovação humana antes de rodar (nada disso é concedido por você nem pela aprovação do plano): manifestos/lockfiles, CI, Docker, hooks, arquivos de segredos (.env), sobrescrita de arquivos por inteiro, caminhos fora do workspace, '
      + 'instalar dependências (esta pode ser autorizada ao aprovar o plano), git que descarta trabalho (reset, clean, checkout, rebase, merge, stash) e efeitos externos (push, deploy, publicar, docker push, kubectl, terraform apply; só aprovação individual). Shell, rede e commit comuns não pedem aprovação.';
  }
  return 'POLÍTICA DO SERVIDOR (fixa; você não pode alterá-la nem conceder aprovações): etapas que peçam instalar dependências, publicar/deploy, commit/push, git que descarta trabalho (reset, clean, checkout, rebase, merge, stash), curl/wget/sudo, apagar arquivos ou pastas, acessar a rede ou usar caminhos fora do workspace são BLOQUEADAS e voltam como falha; '
    + 'etapas que alterem manifestos/lockfiles, CI, Docker, hooks, arquivos de segredos (.env) ou sobrescrevam arquivos por inteiro EXIGEM aprovação humana antes de rodar.';
}
const NEGATION = /\b(n[aã]o|nunca|sem|jamais|never|without|don'?t|do not)\b[^.\n]*$/i; // "não faça commit" não é um pedido de commit

const normText = (s) => String(s ?? '').replace(/\\/g, '/');
/** A regex casa em `text` fora de uma negação imediata? */
function asks(re, text) {
  const g = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
  for (const m of text.matchAll(g)) if (!NEGATION.test(text.slice(Math.max(0, m.index - 40), m.index))) return true;
  return false;
}

/** @returns {{decision:'allow'|'approval_required'|'deny', rules:object[], summary:{what:string, why:string[], impact:string[]}}} */
export function evaluateTask(action, { workspace = null, protectedDirs = [], exists = null } = {}) {
  const rule = (id, decision, reason, impact, subjects) => ({ id, decision, reason, impact, ...(subjects?.length ? { subjects } : {}) });
  const profile = profileOf(workspace), bypass = profile === 'bypass'; // fail-safe: qualquer coisa que não seja exatamente 'bypass' é o perfil padrão
  const wsPath = workspace?.path;
  const there = exists ?? ((rel) => { try { return !!wsPath && fs.existsSync(path.join(wsPath, rel)); } catch { return false; } });
  const a = action && typeof action === 'object' ? action : {};
  const strs = [a.title, a.instructions].every((x) => typeof x === 'string') && (a.acceptance ?? []).every?.((x) => typeof x === 'string') && (a.expectedFiles ?? []).every?.((x) => typeof x === 'string');
  const found = [];
  if (!strs || !wsPath) {
    found.push(rule('unclassifiable', 'deny', 'Não foi possível classificar a ação com segurança (dados incompletos ou espaço de trabalho ausente).', 'Nada é executado quando a ação não pode ser avaliada.'));
  } else {
    const text = normText([a.title, a.instructions, ...(a.acceptance ?? [])].join('\n'));
    const files = (a.expectedFiles ?? []).map((p) => ({ raw: p, rel: safeRelPath(p) }));
    const rels = files.filter((f) => f.rel).map((f) => f.rel);
    const clauses = clausesOf(text);
    /** Arquivos que casam com `re` e são realmente alvo: os de expectedFiles + os citados em contexto de escrita (ou, com `anyUse`, citados sem negação). */
    const mentions = (re, extra, anyUse = false) => {
      const out = new Set(rels.filter((p) => re.test(p) && !(extra && extra.test(p))));
      for (const clause of clauses) {
        for (const m of clause.matchAll(/[^\s"'`(),;]+/g)) {
          const t = m[0].replace(/[.:!?]+$/, '').replace(/^\.\//, '');
          if (!re.test(t) || (extra && extra.test(t))) continue;
          if (NEG_CTX.test(clause.slice(0, m.index))) continue;                                  // "não altere X", "sem tocar em X"
          if (!anyUse && (READ_CTX.test(clause.slice(Math.max(0, m.index - 60), m.index)) || !writes(clause))) continue; // só referência/leitura/execução
          out.add(t);
        }
      }
      return [...out];
    };

    // --- deny (e, em bypass, aprovação individual para caminhos fora do workspace) ---
    const badFiles = files.filter((f) => !f.rel), badPaths = badFiles.map((f) => String(f.raw).slice(0, 80));
    const GIT_REASON = ['A ação mexe na pasta interna do Git (.git).', 'Alterar .git pode corromper o histórico do projeto; nada é executado.'];
    if (!bypass) {
      if (badPaths.length || OUTSIDE_TEXT.test(text)) found.push(rule('outside_workspace', 'deny', 'A ação referencia um caminho fora do espaço de trabalho (absoluto, "..", unidade, pasta do usuário ou diretório interno do Git).', 'O Executor só pode atuar dentro do espaço de trabalho; nada é executado.', badPaths));
      else if (GIT_DIR_TEXT.test(text)) found.push(rule('git_internal', 'deny', ...GIT_REASON));
    } else {
      // .git é negado nos dois perfis (também como caminho de expectedFiles, que a validação de caminho rejeita); o resto fora do workspace vira aprovação INDIVIDUAL (nunca pré-autorizável).
      const gitFiles = badFiles.filter((f) => hasGitSegment(f.raw)), otherBad = badFiles.filter((f) => !hasGitSegment(f.raw));
      if (otherBad.length || OUTSIDE_TEXT.test(text)) {
        const approvable = otherBad.every((f) => approvableOutside(f.raw));
        found.push(rule('outside_workspace', approvable ? 'approval_required' : 'deny', approvable
          ? 'A ação referencia um caminho fora do espaço de trabalho (absoluto, "..", unidade ou pasta do usuário). No modo sem confirmação o Executor não fica preso ao workspace.'
          : 'A ação referencia um caminho inválido (caractere de controle, curinga ou comprimento excessivo) que não pode ser avaliado com segurança.',
        approvable ? 'O Executor pode ler e alterar arquivos fora do espaço de trabalho, com as permissões do usuário; só prossegue com a sua aprovação individual a cada execução.' : 'Nada é executado.', otherBad.map((f) => String(f.raw).slice(0, 80))));
      }
      if (gitFiles.length || GIT_DIR_TEXT.test(text)) found.push(rule('git_internal', 'deny', ...GIT_REASON));
    }
    const inState = rels.filter((rel) => protectedDirs.some((d) => { const r = path.relative(d, path.resolve(wsPath, rel)); return !!d && !r.startsWith('..') && !path.isAbsolute(r); }));
    const wsInState = protectedDirs.some((d) => { const r = path.relative(path.resolve(d), path.resolve(wsPath)); return !r.startsWith('..') && !path.isAbsolute(r); });
    if (inState.length || wsInState || STATE_TEXT.test(text)) found.push(rule('orchestrator_state', 'deny', 'A ação alcança o estado interno do orquestrador (banco de dados, aprovações), que o Executor não pode alterar.', 'Permitir isso deixaria o Executor alterar as próprias aprovações; nada é executado.', inState));
    if (!bypass) {
      for (const [label, re, why] of DEFAULT_DENY) if (asks(re, text)) found.push(rule('unsupported_capability', 'deny', why ?? `A ação pede para ${label}, o que o perfil padrão do Executor não permite (ele edita arquivos do espaço de trabalho e só roda comandos pré-aprovados: testes e git de leitura).`, 'Não existe como executar nem como aprovar esta ação neste perfil; o Planner precisa replanejar sem ela.'));
    } else {
      // Sem confirmação: nada disto é negado, mas o que é difícil de desfazer ou sai da máquina pede um humano. Shell, rede, exclusão e commit comuns passam (heurística de texto, não barreira).
      if (asks(RE_INSTALL, text)) found.push(rule('dependency_install', 'approval_required', 'A etapa pede para instalar dependências, o que baixa e executa código de terceiros (scripts de instalação) com as permissões do usuário.', 'Pacotes novos alteram o projeto e podem alterar a máquina; manifestos e lockfiles mudam. Pode ser autorizada de antemão ao aprovar o plano.', DEPENDENCY_FILES.filter(there)));
      if (asks(RE_EXTERNAL, text)) found.push(rule('external_effect', 'approval_required', 'A ação pede um efeito externo (push, deploy, publicação, docker push, kubectl, terraform apply).', 'Efeitos fora da máquina não se desfazem: exige a sua aprovação individual a cada execução (não pode ser autorizada de antemão).'));
      if (asks(RE_VCS_DESTRUCTIVE, text)) found.push(rule('destructive_vcs', 'approval_required', 'A ação pede um comando Git que descarta ou reescreve trabalho (reset, clean, checkout, rebase, merge, stash).', 'Mudanças ainda não salvas podem ser perdidas ou o histórico alterado; exige a sua aprovação individual.'));
    }

    // --- approval_required ---
    const secrets = mentions(SECRET_FILE, SECRET_EXAMPLE, true);
    if (secrets.length) found.push(rule('secret_files', 'approval_required', 'A etapa lê ou altera arquivos que costumam guardar segredos ou credenciais.', 'O conteúdo desses arquivos pode ser lido pelo Executor (e enviado ao modelo) e alterado. Os valores dos segredos não são gravados na auditoria.', secrets));
    const sensitive = mentions(SENSITIVE_FILE, null, false);
    if (sensitive.length) found.push(rule('sensitive_files', 'approval_required', 'A etapa altera arquivos que definem o que o projeto instala ou executa (dependências, automação, Docker, hooks).', 'Mudar esses arquivos pode alterar dependências, pipelines ou o que roda no projeto.', sensitive));
    if (clauses.some((c) => OVERWRITE_PATTERNS.some((re) => { const m = re.exec(c); return !!m && !NEG_CTX.test(c.slice(0, m.index)); }))) {
      const existing = rels.filter(there);
      found.push(rule('destructive_overwrite', 'approval_required', 'A etapa pede para sobrescrever, esvaziar ou reescrever conteúdo por inteiro.', existing.length ? `O conteúdo atual de ${existing.join(', ')} pode ser perdido (sem Git, não há como desfazer).` : 'Conteúdo existente pode ser perdido (sem Git, não há como desfazer).', existing));
    }
  }
  if (!found.length) found.push(rule('workspace_file_edit', 'allow', 'Ler, criar e editar arquivos comuns dentro do espaço de trabalho.', 'Alterações ficam restritas ao espaço de trabalho e passam pelas verificações reais.'));
  const decision = found.reduce((w, r) => (RANK[r.decision] > RANK[w] ? r.decision : w), 'allow');
  const hit = found.filter((r) => r.decision === decision);
  const files = (Array.isArray(a.expectedFiles) ? a.expectedFiles : []).slice(0, 8);
  return {
    decision, rules: found,
    summary: { what: `Executar a etapa "${clip(a.title, 120)}"${files.length ? ` (arquivos: ${files.join(', ')})` : ''}`, why: hit.map((r) => r.reason), impact: hit.map((r) => `${r.impact}${r.subjects?.length ? ` [${r.subjects.slice(0, 6).join(', ')}]` : ''}`) },
  };
}

/** Impressão digital do que foi apresentado ao humano: ação (texto, arquivos, agente), escopo (etapa/plano), workspace e regras que exigiram a aprovação. Qualquer mudança material gera outro valor. */
export function actionDigest(action, workspace, scope, verdict) {
  const canon = {
    v: POLICY_VERSION, ws: { id: workspace?.id ?? null, path: workspace?.path ?? null }, step: scope?.stepId ?? null, plan: scope?.planId ?? null,
    title: String(action.title ?? '').trim(), instructions: String(action.instructions ?? '').trim(), acceptance: (action.acceptance ?? []).map((x) => String(x).trim()),
    files: [...(action.expectedFiles ?? [])].sort(), agent: action.agent ?? null, rules: verdict.rules.filter((r) => r.decision !== 'allow').map((r) => r.id).sort(),
    // O perfil só entra no digest em bypass: o do perfil padrão fica IDÊNTICO ao de antes (aprovações pendentes já gravadas continuam válidas) e trocar o perfil (nos dois sentidos) anula as pendentes.
    ...(profileOf(workspace) === 'bypass' ? { profile: 'bypass' } : {}),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

// Autorização prévia (ao aprovar o plano): só para o que uma pessoa PODE conceder por etapa. deny nunca; segredos, efeitos externos, git destrutivo e caminho fora do workspace exigem aprovação
// individual na hora; qualquer regra desconhecida também não.
const PREAUTH_RULES = ['sensitive_files', 'destructive_overwrite', 'dependency_install'];
/** @returns {{ok:boolean, reason:string|null}} esta avaliação pode ser pré-autorizada na aprovação do plano? */
export function preAuthProblem(verdict) {
  if (verdict?.decision === 'allow') return { ok: false, reason: 'não precisa de autorização (a política já permite)' };
  if (verdict?.decision !== 'approval_required') return { ok: false, reason: 'é proibida pela política e nunca pode ser autorizada' };
  const ids = (verdict.rules ?? []).filter((r) => r.decision !== 'allow').map((r) => r.id);
  if (ids.includes('secret_files')) return { ok: false, reason: 'lê ou altera arquivos de segredo, que exigem a sua aprovação individual na hora de executar' };
  const other = ids.filter((id) => !PREAUTH_RULES.includes(id));
  if (other.length || !ids.length) return { ok: false, reason: `tem uma regra que não aceita autorização prévia (${other.join(', ') || 'nenhuma regra'})` };
  return { ok: true, reason: null };
}

const APPROVAL_STATUS = ['pending', 'approved', 'rejected', 'consumed', 'void'];
/**
 * Consistência entre aprovações e rodadas gravadas (um banco editado, parcial ou corrompido não pode virar execução): toda aprovação "consumida" tem a rodada que a usou e toda
 * rodada que cita uma aprovação a tem consumida por ela. Devolve o motivo ou null.
 */
export function approvalProblem(c) {
  if (c?.approvals === undefined) return (Array.isArray(c?.rounds) ? c.rounds : []).some((r) => r?.approvalId) ? 'há rodada ligada a uma aprovação, mas o ciclo não tem aprovações gravadas' : null;
  if (!Array.isArray(c.approvals)) return 'as aprovações gravadas não têm a estrutura esperada';
  const rounds = Array.isArray(c.rounds) ? c.rounds : [];
  for (const a of c.approvals) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || typeof a.digest !== 'string' || !APPROVAL_STATUS.includes(a.status)) return 'há uma aprovação gravada com estrutura inválida';
    if (a.origin === 'plan_approval') { // autorização do plano: vários usos limitados; cada rodada que a cita precisa estar registrada nela e vice-versa
      for (const n of Array.isArray(a.consumedRounds) ? a.consumedRounds : []) { const r = rounds.find((x) => x?.n === n); if (!r || r.approvalId !== a.id) return `a autorização do plano ${a.id} consta como usada na rodada ${n}, mas a rodada não a registra: o resultado da ação é incerto`; }
      if (a.status === 'consumed' && !(a.consumedRounds ?? []).length) return `a autorização do plano ${a.id} consta como consumida sem nenhuma rodada`;
    } else if (a.status === 'consumed') {
      const r = rounds.find((x) => x?.n === a.consumedRound);
      if (!r || r.approvalId !== a.id) return `a aprovação ${a.id} consta como consumida, mas a rodada ${a.consumedRound} não a registra: o resultado da ação é incerto`;
    }
  }
  for (const r of rounds) {
    if (!r?.approvalId) continue;
    const a = c.approvals.find((x) => x.id === r.approvalId);
    if (a?.origin === 'plan_approval') { if (!(a.consumedRounds ?? []).includes(r.n) || a.digest !== r.approvalDigest) return `a rodada ${r.n} foi executada com a autorização do plano ${r.approvalId}, mas o registro dessa autorização está ausente ou inconsistente: o resultado da ação é incerto`; continue; }
    if (!a || a.status !== 'consumed' || a.consumedRound !== r.n || a.digest !== r.approvalDigest) return `a rodada ${r.n} foi executada com a aprovação ${r.approvalId}, mas o registro dessa aprovação está ausente ou inconsistente: o resultado da ação é incerto`;
  }
  return null;
}
