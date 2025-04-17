import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import DownloadIcon from '@mui/icons-material/Download';
import { styled } from '@mui/material/styles';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import hcl from 'react-syntax-highlighter/dist/cjs/languages/prism/hcl';

// Register HCL (HashiCorp Configuration Language) for Terraform files
SyntaxHighlighter.registerLanguage('hcl', hcl);

const FONT_FAMILY = '"Fira Code", "Consolas", monospace';
const FONT_SIZE = '14px';
const LINE_HEIGHT = '20px';
const PADDING = '16px';

const CodeContainer = styled(Paper)(({ theme }) => ({
  position: 'relative',
  backgroundColor: '#1E1E1E',
  borderRadius: theme.shape.borderRadius,
  overflow: 'hidden',
}));

const ButtonsContainer = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: theme.spacing(1),
  right: theme.spacing(1),
  zIndex: 2,
  display: 'flex',
  gap: theme.spacing(1),
}));

const ActionButton = styled(IconButton)(({ theme }) => ({
  color: '#fff',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
}));

interface CodeSnippetProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  filename?: string;
}

export default function CodeSnippet({ 
  code, 
  language = 'hcl',
  showLineNumbers = true,
  filename = 'Aurora.tf'
}: CodeSnippetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([code], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download file: ', err);
    }
  };

  return (
    <CodeContainer elevation={3}>
      <ButtonsContainer>
        <ActionButton onClick={handleCopy} size="small" title="Copy to clipboard">
          {copied ? <CheckIcon /> : <ContentCopyIcon />}
        </ActionButton>
        <ActionButton onClick={handleDownload} size="small" title="Download as .tf">
          <DownloadIcon />
        </ActionButton>
      </ButtonsContainer>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        showLineNumbers={showLineNumbers}
        customStyle={{
          margin: 0,
          padding: PADDING,
          background: 'transparent',
          fontSize: FONT_SIZE,
          lineHeight: LINE_HEIGHT,
          fontFamily: FONT_FAMILY,
        }}
      >
        {code}
      </SyntaxHighlighter>
    </CodeContainer>
  );
} 