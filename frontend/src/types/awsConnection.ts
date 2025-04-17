import React from 'react';

export interface AWSConnection {
  userId: string;
  name: string;
  provider: 'aws';
  description?: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    sessionToken?: string;
  };
  accounts?: string[];
  isValidated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AWSConnectionStep {
  title: string;
  description: string;
  component: React.ComponentType<any>;
}

export interface AWSConnectionFormData {
  step1: {
    name: string;
    provider: 'aws';
    region: string;
    description?: string;
  };
  step2: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  step3: {
    accounts: string[];
  };
  step4: {
    isValid?: boolean;
  };
} 