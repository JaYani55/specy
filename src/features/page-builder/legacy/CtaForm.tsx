import React from 'react';
import { useFormContext } from 'react-hook-form';
import { PageBuilderData } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface CtaFormProps {
  form: ReturnType<typeof useFormContext<PageBuilderData>>;
}

export const CtaForm: React.FC<CtaFormProps> = ({ form }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>📣</span>
          <span>Call-to-Action</span>
        </CardTitle>
        <CardDescription>
          Motivieren Sie Ihre Besucher zum Handeln
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="cta-title" className="text-base font-semibold">
            CTA Titel
          </Label>
          <Input
            id="cta-title"
            {...form.register('cta.title')}
            placeholder="z.B. BEREIT FÜR MEHR AWARENESS IM TEAM?"
            className="text-lg font-semibold"
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="cta-description" className="text-base font-semibold">
            Beschreibung
          </Label>
          <Textarea
            id="cta-description"
            {...form.register('cta.description')}
            placeholder="Beschreiben Sie, warum Besucher jetzt handeln sollten..."
            rows={4}
            className="resize-none"
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="cta-button" className="text-base font-semibold">
            Button-Text
          </Label>
          <Input
            id="cta-button"
            {...form.register('cta.primaryButton')}
            placeholder="z.B. Session buchen"
          />
          <p className="text-xs text-muted-foreground">
            Kurz und handlungsorientiert formulieren
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
