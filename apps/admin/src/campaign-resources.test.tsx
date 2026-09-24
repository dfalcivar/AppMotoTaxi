import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CampaignResources} from './campaign-resources';
it('explains four optional surfaces and three theme variants',()=>{
 const html=renderToStaticMarkup(<CampaignResources campaign={{headerDecorationMode:'EDGES'}} token="fixture" disabled={false} onUpload={()=>{}}/>);
 for(const label of ['Imagen para Home','Imagen principal','Decoración de isla superior','Decoración adicional','General (ambos temas)','Claro opcional','Oscuro opcional','Vista previa de la isla en la app'])expect(html).toContain(label);
 expect((html.match(/type="file"/g)||[]).length).toBe(12);
 expect((html.match(/accept="image\/png,image\/webp"/g)||[]).length).toBe(3);
 expect(html).not.toContain('required=');
});
it('explains missing storage and hides mutations for read-only users',()=>{
 const html=renderToStaticMarkup(<CampaignResources campaign={{assets:['MAIN']}} token="fixture" disabled={true} storageReady={false} onUpload={()=>{}}/>);
 expect(html).toContain('Falta configurar el almacenamiento de objetos');expect(html).not.toContain('type="file"');
});
