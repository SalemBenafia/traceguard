import React from 'react';
import { SectionMessage, Text } from '@forge/react';

export const errorMessage = (text) => ({ appearance: 'error', text });

export const StatusMessage = ({ message }) => (
  <SectionMessage appearance={message.appearance}>
    <Text>{message.text}</Text>
  </SectionMessage>
);
