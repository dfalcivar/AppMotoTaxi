import {describe,expect,it} from 'vitest';
import {renderCommercialCampaignEmail} from './commercial-email-notifications.js';

const data={campaignId:'demo',campaign:'Costa Verano <script>',business:'Hotel & Mar',contact:'Marta <Admin>',email:'marta@example.com',plan:'Premium',zone:'Tonsupa',startsAt:'2026-08-01T05:00:00.000Z',endsAt:'2026-09-12T05:00:00.000Z',periodStart:'2026-08-01T05:00:00.000Z',periodEnd:'2026-09-01T05:00:00.000Z',impressions:100,clicks:5,ctr:5,activeDays:31,renewalUrl:'https://costa-go.com/anunciarme'};

describe('correos comerciales',()=>{
  it('usa la plantilla Costa-Go y métricas reales sin alcance estimado',()=>{
    const rendered=renderCommercialCampaignEmail('CAMPAIGN_MONTHLY_REPORT',data);
    expect(rendered.html).toContain('data-costa-go-email="true"');
    expect(rendered.html).toContain('100');
    expect(rendered.html).toContain('5.00%');
    expect(rendered.html).not.toContain('Alcance');
    expect(rendered.html).toContain('Costa Verano &lt;script&gt;');
    expect(rendered.html).toContain('Marta &lt;Admin&gt;');
  });
  it('renderiza los cuatro eventos con el mismo layout',()=>{
    for(const event of ['CAMPAIGN_EXPIRING_7D','CAMPAIGN_EXPIRING_3D','CAMPAIGN_EXPIRED','CAMPAIGN_MONTHLY_REPORT'] as const)
      expect(renderCommercialCampaignEmail(event,data).html).toContain('data-costa-go-email="true"');
  });
});
