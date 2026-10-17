import { TestBed } from '@angular/core/testing';
import { App } from './app';
describe('App', () => { it('renders the project name', async () => { await TestBed.configureTestingModule({imports:[App]}).compileComponents();const fixture=TestBed.createComponent(App);fixture.detectChanges();expect(fixture.nativeElement.querySelector('h1').textContent).toContain('__PROJECT_KEY__'); }); });
