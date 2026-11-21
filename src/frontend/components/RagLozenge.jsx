import React from 'react';
import { Lozenge } from '@forge/react';

const RAG_APPEARANCE = { green: 'success', amber: 'moved', red: 'removed' };

export const RagLozenge = ({ rag }) => <Lozenge appearance={RAG_APPEARANCE[rag]}>{rag}</Lozenge>;
