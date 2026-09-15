import type { Metadata } from 'next'
import Link from 'next/link'
import DocumentosLegais from '@/components/legal/DocumentosLegais'
import { BRAND } from '@/content/site'
import styles from './privacidade-e-termos.module.css'

export const metadata: Metadata = {
  title: `Privacidade e Termos — ${BRAND}`,
  description: 'Documentos em vigor, direitos do titular e canal do encarregado.',
}

/**
 * Ponto fixo de acesso aos documentos legais — RF-01, RF-05.
 *
 * Os documentos NAO sao reescritos aqui: esta tela lista, diz qual versao
 * esta em vigor e leva ao texto. Repetir a clausula nesta pagina criaria uma
 * segunda versao do documento — e a divergencia entre as duas e o que a prova
 * de consentimento nao sobrevive.
 */
export default function PrivacidadeETermosPage() {
  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <h1 className={styles.titulo}>Privacidade e Termos</h1>
        <p className={styles.subtitulo}>
          Os documentos que valem para a sua conta, e como exercer seus direitos.
        </p>
      </header>

      <section className={styles.cartao} aria-label="Documentos em vigor">
        <h2 className={styles.secaoTitulo}>Documentos em vigor</h2>
        <DocumentosLegais />

        <p className={styles.nota}>
          Quando publicarmos uma versão nova, você será avisado no painel e poderá lê-la antes de
          aceitar. Seus aceites anteriores ficam registrados.
        </p>
      </section>

      <section className={styles.cartao} aria-label="Seus direitos">
        <h2 className={styles.secaoTitulo}>Seus direitos (LGPD art. 18)</h2>
        <p className={styles.texto}>
          Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados, além de revogar
          consentimentos.
        </p>
        <ul className={styles.direitos}>
          <li>
            <strong>Acesso e portabilidade:</strong> a exportação completa dos dados da sua empresa
            está em{' '}
            <Link href="/app/empresa" className={styles.link}>
              Empresa
            </Link>
            .
          </li>
          <li>
            <strong>Correção:</strong> os dados cadastrais são editáveis na mesma tela.
          </li>
          <li>
            <strong>Exclusão e revogação:</strong> peça pelo{' '}
            <Link href="/app/suporte" className={styles.link}>
              Suporte
            </Link>
            . O pedido é atendido no prazo legal.
          </li>
        </ul>

        {/*
          O canal do encarregado ainda nao existe — DEC-016/QST-004 estao
          abertas e sao decisao de negocio, nao de engenharia. Dizer isto em
          voz alta e melhor que inventar um e-mail: um contato de DPO que nao
          responde e pior para o titular do que a ausencia declarada dele, e
          e a ausencia que faz alguem fechar a decisao.
        */}
        <p className={styles.pendente} role="note">
          <strong>Pendente:</strong> o contato do encarregado (DPO) será publicado aqui e na
          Política de Privacidade assim que a revisão jurídica for concluída. Enquanto isso, use o
          Suporte — todo pedido é registrado com data.
        </p>
      </section>
    </div>
  )
}
